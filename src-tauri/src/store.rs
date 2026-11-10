use crate::db_reader::SafeDbReader;
use crate::models::{
    ConversationRecord, DashboardSummary, ModelBreakdown, ModelPrice, ProjectSummary, SyncStats,
    TimelinePoint, TurnRecord,
};
use crate::pricing::{default_pricing, PricingEngine};
use crate::proto_parser::decode_gen_metadata;
use crate::roots::AntigravityRoot;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone, Utc};
use rayon::prelude::*;
use rusqlite::{params, Connection, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

pub struct MetricsStore {
    conn: Connection,
}

struct PreparedTurn {
    conv_id: String,
    turn_idx: i64,
    timestamp: i64,
    model_name: String,
    input_tokens: i64,
    cache_read_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
}

struct ConvParseResult {
    conv_id: String,
    new_last_idx: i64,
    turns: Vec<PreparedTurn>,
    max_context: i64,
    parse_status: &'static str,
}

impl MetricsStore {
    pub fn new(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;"
        )?;

        let store = Self { conn };
        store.migrate()?;
        store.seed_pricing_if_empty()?;
        Ok(store)
    }

    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.migrate()?;
        store.seed_pricing_if_empty()?;
        Ok(store)
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                origin TEXT NOT NULL,
                db_root TEXT,
                parse_status TEXT DEFAULT 'ok',
                title TEXT NOT NULL,
                workspace_path TEXT,
                project_alias TEXT,
                first_seen_at INTEGER NOT NULL,
                last_updated_at INTEGER NOT NULL,
                last_processed_idx INTEGER DEFAULT 0,
                total_turns INTEGER DEFAULT 0,
                max_context_tokens INTEGER DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_path);
            CREATE INDEX IF NOT EXISTS idx_conversations_parent ON conversations(parent_id);

            CREATE TABLE IF NOT EXISTS turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                turn_idx INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                model_name TEXT NOT NULL,
                input_tokens INTEGER DEFAULT 0,
                cache_read_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                thinking_tokens INTEGER,
                cost_usd REAL DEFAULT 0.0,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id),
                UNIQUE(conversation_id, turn_idx)
            );

            CREATE INDEX IF NOT EXISTS idx_turns_conversation ON turns(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);

            CREATE TABLE IF NOT EXISTS sync_checkpoints (
                source_root TEXT PRIMARY KEY,
                last_scan_timestamp INTEGER NOT NULL
            );"
        )?;

        let has_valid_from: bool = self.conn.prepare("SELECT valid_from FROM model_pricing LIMIT 1").is_ok();
        if !has_valid_from {
            self.conn.execute_batch(
                "DROP TABLE IF EXISTS model_pricing;
                 CREATE TABLE model_pricing (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     model_pattern TEXT NOT NULL,
                     display_name TEXT NOT NULL,
                     input_per_1m REAL NOT NULL,
                     cache_read_per_1m REAL NOT NULL,
                     output_per_1m REAL NOT NULL,
                     valid_from INTEGER,
                     valid_to INTEGER
                 );"
            )?;
        }

        Ok(())
    }

    fn seed_pricing_if_empty(&self) -> Result<()> {
        let count: i64 = self
            .conn
            .query_row("SELECT count(*) FROM model_pricing", [], |r| r.get(0))?;
        if count == 0 {
            let mut stmt = self.conn.prepare(
                "INSERT INTO model_pricing (model_pattern, display_name, input_per_1m, cache_read_per_1m, output_per_1m, valid_from, valid_to)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
            )?;
            for p in default_pricing() {
                stmt.execute(params![
                    p.model_pattern,
                    p.display_name,
                    p.input_per_1m,
                    p.cache_read_per_1m,
                    p.output_per_1m,
                    p.valid_from,
                    p.valid_to
                ])?;
            }
        }
        Ok(())
    }

    pub fn get_pricing(&self) -> Result<Vec<ModelPrice>> {
        let mut stmt = self.conn.prepare(
            "SELECT model_pattern, display_name, input_per_1m, cache_read_per_1m, output_per_1m, valid_from, valid_to FROM model_pricing ORDER BY id ASC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ModelPrice {
                model_pattern: row.get(0)?,
                display_name: row.get(1)?,
                input_per_1m: row.get(2)?,
                cache_read_per_1m: row.get(3)?,
                output_per_1m: row.get(4)?,
                valid_from: row.get(5)?,
                valid_to: row.get(6)?,
            })
        })?;

        let mut prices = Vec::new();
        for r in rows {
            prices.push(r?);
        }
        Ok(prices)
    }

    pub fn update_pricing(&mut self, prices: Vec<ModelPrice>) -> Result<()> {
        let tx = self.conn.transaction()?;
        {
            tx.execute("DELETE FROM model_pricing", [])?;
            let mut insert_price = tx.prepare(
                "INSERT INTO model_pricing (model_pattern, display_name, input_per_1m, cache_read_per_1m, output_per_1m, valid_from, valid_to)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
            )?;
            for p in &prices {
                insert_price.execute(params![
                    p.model_pattern,
                    p.display_name,
                    p.input_per_1m,
                    p.cache_read_per_1m,
                    p.output_per_1m,
                    p.valid_from,
                    p.valid_to
                ])?;
            }

            // Recalculate costs for all turns
            let engine = PricingEngine::new(prices);
            let mut select_turns = tx.prepare("SELECT id, model_name, input_tokens, cache_read_tokens, output_tokens, timestamp FROM turns")?;
            let turn_rows: Vec<(i64, String, i64, i64, i64, i64)> = select_turns
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
                .flatten()
                .collect();

            let mut update_cost = tx.prepare("UPDATE turns SET cost_usd = ?1 WHERE id = ?2")?;
            for (id, model, in_tok, cache_tok, out_tok, ts) in turn_rows {
                let (cost, _) = engine.calculate_cost_at(
                    &model,
                    Some(ts),
                    in_tok as u64,
                    cache_tok as u64,
                    out_tok as u64,
                );
                update_cost.execute(params![cost, id])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn sync_all(&mut self, roots: &[AntigravityRoot]) -> Result<SyncStats> {
        let start = Instant::now();
        let pricing = self.get_pricing()?;
        let pricing_engine = Arc::new(PricingEngine::new(pricing));

        // Pre-index existing non-empty DBs per root in O(1) time
        let mut db_index: HashMap<String, PathBuf> = HashMap::new();
        for root in roots {
            if let Ok(entries) = std::fs::read_dir(root.conversations_dir()) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) == Some("db") {
                        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                            if let Ok(meta) = entry.metadata() {
                                if meta.len() > 0 {
                                    db_index.insert(stem.to_string(), path);
                                }
                            }
                        }
                    }
                }
            }
        }

        // 1. Gather all conversation summaries from all roots
        #[derive(Clone)]
        struct DiscoveredConv {
            id: String,
            parent_id: Option<String>,
            origin: String,
            title: String,
            workspace_path: Option<String>,
            last_modified_sec: i64,
            db_path: Option<PathBuf>,
        }

        let mut discovered: HashMap<String, DiscoveredConv> = HashMap::new();

        for root in roots {
            let sum_path = root.summaries_db();
            if let Ok(summaries) = SafeDbReader::read_summaries(&sum_path) {
                for s in summaries {
                    let origin = if s.source == "CORTEX_TRAJECTORY_SOURCE_CLI" {
                        "CLI".to_string()
                    } else {
                        "IDE".to_string()
                    };

                    let parent_id = if !s.parent_conversation_id.trim().is_empty() {
                        Some(s.parent_conversation_id.trim().to_string())
                    } else {
                        None
                    };

                    let workspace_path = extract_workspace_path(&s.workspace_uris);
                    let last_modified_sec = parse_iso_time(&s.last_modified_time);
                    let db_path = db_index.get(&s.conversation_id).cloned();

                    if let Some(existing) = discovered.get_mut(&s.conversation_id) {
                        if existing.db_path.is_none() && db_path.is_some() {
                            existing.db_path = db_path;
                        }
                    } else {
                        discovered.insert(
                            s.conversation_id.clone(),
                            DiscoveredConv {
                                id: s.conversation_id,
                                parent_id,
                                origin,
                                title: s.title,
                                workspace_path,
                                last_modified_sec,
                                db_path,
                            },
                        );
                    }
                }
            }
        }

        // Get current local state (last_processed_idx, total_turns, max_context)
        let mut existing_states: HashMap<String, (i64, i64, i64)> = HashMap::new();
        {
            let mut stmt = self.conn.prepare("SELECT id, last_processed_idx, total_turns, max_context_tokens FROM conversations")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?))))?;
            for r in rows {
                let (id, state) = r?;
                existing_states.insert(id, state);
            }
        }

        // 2. Parallel extraction of new turns using Rayon across all CPU cores
        let work_items: Vec<(DiscoveredConv, i64, i64, i64)> = discovered
            .values()
            .cloned()
            .map(|conv| {
                let (last_idx, turns, ctx) = existing_states.get(&conv.id).copied().unwrap_or((0, 0, 0));
                (conv, last_idx, turns, ctx)
            })
            .collect();

        let parsed_results: Vec<ConvParseResult> = work_items
            .into_par_iter()
            .map(|(conv, mut last_idx, _, mut max_context)| {
                let mut parse_status = if conv.db_path.is_some() { "ok" } else { "no_data" };
                let mut turns = Vec::new();

                if let Some(ref db_path) = conv.db_path {
                    if let Ok(metadata_rows) = SafeDbReader::read_gen_metadata(db_path) {
                        for (idx, data) in metadata_rows {
                            if idx > last_idx {
                                if let Some(turn) = decode_gen_metadata(&data) {
                                    let model = turn.model_name.unwrap_or_else(|| "desconocido".to_string());
                                    let (cost, _) = pricing_engine.calculate_cost_at(
                                        &model,
                                        Some(conv.last_modified_sec),
                                        turn.input_tokens,
                                        turn.cache_read_tokens,
                                        turn.output_tokens,
                                    );

                                    let context = (turn.input_tokens + turn.cache_read_tokens) as i64;
                                    if context > max_context {
                                        max_context = context;
                                    }

                                    turns.push(PreparedTurn {
                                        conv_id: conv.id.clone(),
                                        turn_idx: idx,
                                        timestamp: conv.last_modified_sec,
                                        model_name: model,
                                        input_tokens: turn.input_tokens as i64,
                                        cache_read_tokens: turn.cache_read_tokens as i64,
                                        output_tokens: turn.output_tokens as i64,
                                        cost_usd: cost,
                                    });

                                    last_idx = idx;
                                } else {
                                    parse_status = "partial";
                                }
                            }
                        }
                    }
                }

                ConvParseResult {
                    conv_id: conv.id,
                    new_last_idx: last_idx,
                    turns,
                    max_context,
                    parse_status,
                }
            })
            .collect();

        // 3. Fast bulk insert inside transaction
        let mut total_turns_processed = 0;
        let mut new_conversations = 0;
        let total_conversations = discovered.len();

        let tx = self.conn.transaction()?;
        {
            let mut upsert_conv = tx.prepare(
                "INSERT INTO conversations (id, parent_id, origin, db_root, parse_status, title, workspace_path, first_seen_at, last_updated_at, last_processed_idx, total_turns, max_context_tokens)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    workspace_path = COALESCE(excluded.workspace_path, conversations.workspace_path),
                    last_updated_at = excluded.last_updated_at,
                    db_root = COALESCE(excluded.db_root, conversations.db_root),
                    last_processed_idx = excluded.last_processed_idx,
                    total_turns = excluded.total_turns,
                    max_context_tokens = excluded.max_context_tokens,
                    parse_status = excluded.parse_status"
            )?;

            let mut insert_turn = tx.prepare(
                "INSERT OR IGNORE INTO turns (conversation_id, turn_idx, timestamp, model_name, input_tokens, cache_read_tokens, output_tokens, thinking_tokens, cost_usd)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
            )?;

            for res in parsed_results {
                let conv = match discovered.get(&res.conv_id) {
                    Some(c) => c,
                    None => continue,
                };

                let prev_turns = existing_states.get(&res.conv_id).map(|s| s.1).unwrap_or(0);
                if prev_turns == 0 && !res.turns.is_empty() {
                    new_conversations += 1;
                }

                let new_turns_count = res.turns.len();
                let current_total_turns = prev_turns + new_turns_count as i64;
                total_turns_processed += new_turns_count;

                let db_root_str = conv.db_path.as_ref().map(|p| p.to_string_lossy().to_string());
                upsert_conv.execute(params![
                    conv.id,
                    conv.parent_id,
                    conv.origin,
                    db_root_str,
                    res.parse_status,
                    conv.title,
                    conv.workspace_path,
                    conv.last_modified_sec,
                    conv.last_modified_sec,
                    res.new_last_idx,
                    current_total_turns,
                    res.max_context,
                ])?;

                for t in res.turns {
                    insert_turn.execute(params![
                        t.conv_id,
                        t.turn_idx,
                        t.timestamp,
                        t.model_name,
                        t.input_tokens,
                        t.cache_read_tokens,
                        t.output_tokens,
                        Option::<i64>::None,
                        t.cost_usd
                    ])?;
                }
            }
        }
        tx.commit()?;

        Ok(SyncStats {
            total_conversations,
            new_conversations,
            total_turns_processed,
            duration_ms: start.elapsed().as_millis(),
        })
    }

    pub fn sync_single_db(&mut self, _roots: &[AntigravityRoot], db_path: &Path) -> Result<usize> {
        let conv_id = match db_path.file_stem().and_then(|s| s.to_str()) {
            Some(id) => id.to_string(),
            None => return Ok(0),
        };

        if !db_path.exists() || std::fs::metadata(db_path).map(|m| m.len()).unwrap_or(0) == 0 {
            return Ok(0);
        }

        let pricing = self.get_pricing()?;
        let pricing_engine = PricingEngine::new(pricing);

        let (mut last_idx, mut total_turns, mut max_context): (i64, i64, i64) = self
            .conn
            .query_row(
                "SELECT last_processed_idx, total_turns, max_context_tokens FROM conversations WHERE id = ?1",
                params![conv_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap_or((0, 0, 0));

        let metadata_rows = match SafeDbReader::read_gen_metadata(db_path) {
            Ok(r) => r,
            Err(_) => return Ok(0),
        };

        let now_sec = Utc::now().timestamp();
        let mut new_turns_count = 0;

        let tx = self.conn.transaction()?;
        {
            let mut insert_turn = tx.prepare(
                "INSERT OR IGNORE INTO turns (conversation_id, turn_idx, timestamp, model_name, input_tokens, cache_read_tokens, output_tokens, thinking_tokens, cost_usd)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
            )?;

            for (idx, data) in metadata_rows {
                if idx > last_idx {
                    if let Some(turn) = decode_gen_metadata(&data) {
                        let model = turn.model_name.unwrap_or_else(|| "desconocido".to_string());
                        let (cost, _) = pricing_engine.calculate_cost_at(
                            &model,
                            Some(now_sec),
                            turn.input_tokens,
                            turn.cache_read_tokens,
                            turn.output_tokens,
                        );

                        let context = (turn.input_tokens + turn.cache_read_tokens) as i64;
                        if context > max_context {
                            max_context = context;
                        }

                        insert_turn.execute(params![
                            conv_id,
                            idx,
                            now_sec,
                            model,
                            turn.input_tokens as i64,
                            turn.cache_read_tokens as i64,
                            turn.output_tokens as i64,
                            Option::<i64>::None,
                            cost
                        ])?;

                        last_idx = idx;
                        total_turns += 1;
                        new_turns_count += 1;
                    }
                }
            }

            if new_turns_count > 0 {
                tx.execute(
                    "UPDATE conversations SET
                        last_processed_idx = ?1,
                        total_turns = ?2,
                        max_context_tokens = ?3,
                        last_updated_at = ?4
                     WHERE id = ?5",
                    params![last_idx, total_turns, max_context, now_sec, conv_id],
                )?;
            }
        }
        tx.commit()?;

        Ok(new_turns_count)
    }

    pub fn get_dashboard_summary(
        &self,
        date_filter: &str,
        origin_filter: &str,
        subscription_cost: f64,
        custom_start: Option<i64>,
        custom_end: Option<i64>,
    ) -> Result<DashboardSummary> {
        let (min_timestamp, max_timestamp, is_hourly) =
            resolve_date_filter(date_filter, custom_start, custom_end);

        let origin_clause = match origin_filter.to_lowercase().as_str() {
            "ide" => " AND c.origin = 'IDE'",
            "cli" => " AND c.origin = 'CLI'",
            _ => "",
        };

        // 1. KPI Totals
        let sql = format!(
            "SELECT
                COALESCE(SUM(t.input_tokens), 0),
                COALESCE(SUM(t.cache_read_tokens), 0),
                COALESCE(SUM(t.output_tokens), 0),
                COALESCE(SUM(t.cost_usd), 0.0),
                COUNT(DISTINCT c.id),
                COUNT(t.id)
             FROM turns t
             JOIN conversations c ON t.conversation_id = c.id
             WHERE t.timestamp >= ?1 AND t.timestamp <= ?2 {}",
            origin_clause
        );

        let (total_input, total_cache, total_output, total_cost, total_convs, total_turns): (
            i64,
            i64,
            i64,
            f64,
            i64,
            i64,
        ) = self.conn.query_row(&sql, params![min_timestamp, max_timestamp], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        })?;

        // 2. Cache Hit Rate %
        let cache_hit_rate = if total_cache + total_input > 0 {
            (total_cache as f64 / (total_cache + total_input) as f64) * 100.0
        } else {
            0.0
        };

        // 3. Cache Savings Calculation
        let pricing = self.get_pricing()?;
        let mut cache_savings_usd = 0.0;
        let pricing_engine = PricingEngine::new(pricing);

        let cache_by_model_sql = format!(
            "SELECT t.model_name, SUM(t.cache_read_tokens)
             FROM turns t
             JOIN conversations c ON t.conversation_id = c.id
             WHERE t.timestamp >= ?1 AND t.timestamp <= ?2 {}
             GROUP BY t.model_name",
            origin_clause
        );

        let mut stmt = self.conn.prepare(&cache_by_model_sql)?;
        let rows = stmt.query_map(params![min_timestamp, max_timestamp], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;

        for r in rows.flatten() {
            let (model, cache_tok) = r;
            if cache_tok > 0 {
                // Calculate savings: (input_price - cache_price) * cache_tokens
                let ts = if max_timestamp < i64::MAX { Some(max_timestamp) } else { None };
                let (full_cost, _) = pricing_engine.calculate_cost_at(&model, ts, cache_tok as u64, 0, 0);
                let (cache_cost, _) = pricing_engine.calculate_cost_at(&model, ts, 0, cache_tok as u64, 0);
                if full_cost > cache_cost {
                    cache_savings_usd += full_cost - cache_cost;
                }
            }
        }

        // 4. ROI Multiplier
        let roi_multiplier = if subscription_cost > 0.0 {
            total_cost / subscription_cost
        } else {
            0.0
        };

        // 5. Timeline History
        let history = self.query_timeline(min_timestamp, max_timestamp, is_hourly, origin_clause)?;

        // 6. Model Breakdown
        let models = self.query_model_breakdown(min_timestamp, max_timestamp, origin_clause, total_cost)?;

        // 7. Active Session (most recently updated conversation)
        let active_session = self.query_active_session()?;

        Ok(DashboardSummary {
            total_input_tokens: total_input,
            total_cache_tokens: total_cache,
            total_output_tokens: total_output,
            total_cost_usd: total_cost,
            cache_savings_usd,
            cache_hit_rate,
            total_conversations: total_convs,
            total_turns,
            subscription_cost_usd: subscription_cost,
            roi_multiplier,
            history,
            models,
            active_session,
        })
    }

    fn query_timeline(
        &self,
        min_timestamp: i64,
        max_timestamp: i64,
        is_hourly: bool,
        origin_clause: &str,
    ) -> Result<Vec<TimelinePoint>> {
        let strftime_format = if is_hourly { "%H:00" } else { "%Y-%m-%d" };
        let sql = format!(
            "SELECT
                strftime('{}', datetime(t.timestamp, 'unixepoch', 'localtime')) as label,
                SUM(t.input_tokens),
                SUM(t.cache_read_tokens),
                SUM(t.output_tokens),
                SUM(t.cost_usd)
             FROM turns t
             JOIN conversations c ON t.conversation_id = c.id
             WHERE t.timestamp >= ?1 AND t.timestamp <= ?2 {}
             GROUP BY label
             ORDER BY label ASC",
            strftime_format, origin_clause
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![min_timestamp, max_timestamp], |r| {
            Ok(TimelinePoint {
                label: r.get(0)?,
                input_tokens: r.get(1)?,
                cache_tokens: r.get(2)?,
                output_tokens: r.get(3)?,
                cost_usd: r.get(4)?,
            })
        })?;

        let mut raw_points = Vec::new();
        for r in rows {
            raw_points.push(r?);
        }

        Ok(Self::zero_fill_timeline(raw_points, min_timestamp, max_timestamp, is_hourly))
    }

fn zero_fill_timeline(
    raw_points: Vec<TimelinePoint>,
    min_timestamp: i64,
    max_timestamp: i64,
    is_hourly: bool,
) -> Vec<TimelinePoint> {
    if raw_points.is_empty() {
        return raw_points;
    }

    let mut points_map: HashMap<String, TimelinePoint> = HashMap::new();
    for p in raw_points {
        points_map.insert(p.label.clone(), p);
    }

    let mut filled = Vec::new();
    let now = Local::now();

    if is_hourly {
        for h in 0..=23 {
            let label = format!("{:02}:00", h);
            if let Some(p) = points_map.remove(&label) {
                filled.push(p);
            } else {
                filled.push(TimelinePoint {
                    label,
                    input_tokens: 0,
                    cache_tokens: 0,
                    output_tokens: 0,
                    cost_usd: 0.0,
                });
            }
        }
    } else {
        let start_date = if min_timestamp > 0 {
            DateTime::from_timestamp(min_timestamp, 0)
                .map(|dt| dt.with_timezone(&Local).date_naive())
                .unwrap_or_else(|| now.date_naive())
        } else {
            points_map
                .keys()
                .filter_map(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
                .min()
                .unwrap_or_else(|| now.date_naive())
        };

        let effective_max = if max_timestamp < i64::MAX {
            max_timestamp
        } else {
            now.timestamp()
        };
        let end_date = DateTime::from_timestamp(effective_max, 0)
            .map(|dt| dt.with_timezone(&Local).date_naive())
            .unwrap_or_else(|| now.date_naive());

        let mut curr = start_date;
        let mut count = 0;
        while curr <= end_date && count < 366 {
            let label = curr.format("%Y-%m-%d").to_string();
            if let Some(p) = points_map.remove(&label) {
                filled.push(p);
            } else {
                filled.push(TimelinePoint {
                    label,
                    input_tokens: 0,
                    cache_tokens: 0,
                    output_tokens: 0,
                    cost_usd: 0.0,
                });
            }
            curr += Duration::days(1);
            count += 1;
        }
    }

    for (_, p) in points_map {
        filled.push(p);
    }

    filled
}

    fn query_model_breakdown(
        &self,
        min_timestamp: i64,
        max_timestamp: i64,
        origin_clause: &str,
        total_cost: f64,
    ) -> Result<Vec<ModelBreakdown>> {
        let sql = format!(
            "SELECT
                t.model_name,
                SUM(t.input_tokens + t.cache_read_tokens + t.output_tokens) as total_tok,
                SUM(t.cost_usd) as cost
             FROM turns t
             JOIN conversations c ON t.conversation_id = c.id
             WHERE t.timestamp >= ?1 AND t.timestamp <= ?2 {}
             GROUP BY t.model_name
             ORDER BY cost DESC",
            origin_clause
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![min_timestamp, max_timestamp], |r| {
            let model: String = r.get(0)?;
            let total_tok: i64 = r.get(1)?;
            let cost: f64 = r.get(2)?;
            let pct = if total_cost > 0.0 {
                (cost / total_cost) * 100.0
            } else {
                0.0
            };
            Ok(ModelBreakdown {
                model_name: model,
                total_tokens: total_tok,
                cost_usd: cost,
                percentage: pct,
            })
        })?;

        let mut models = Vec::new();
        for r in rows {
            models.push(r?);
        }
        Ok(models)
    }

    fn query_active_session(&self) -> Result<Option<ConversationRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, parent_id, origin, db_root, parse_status, title, workspace_path, project_alias, first_seen_at, last_updated_at, last_processed_idx, total_turns, max_context_tokens
             FROM conversations
             ORDER BY last_updated_at DESC
             LIMIT 1"
        )?;

        let mut rows = stmt.query_map([], |r| {
            Ok(ConversationRecord {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                origin: r.get(2)?,
                db_root: r.get(3)?,
                parse_status: r.get(4)?,
                title: r.get(5)?,
                workspace_path: r.get(6)?,
                project_alias: r.get(7)?,
                first_seen_at: r.get(8)?,
                last_updated_at: r.get(9)?,
                last_processed_idx: r.get(10)?,
                total_turns: r.get(11)?,
                max_context_tokens: r.get(12)?,
            })
        })?;

        if let Some(first) = rows.next() {
            Ok(Some(first?))
        } else {
            Ok(None)
        }
    }

    pub fn get_projects_summary(&self) -> Result<Vec<ProjectSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT
                COALESCE(c.workspace_path, 'Sin Proyecto') as ws,
                COALESCE(c.project_alias, '') as alias,
                COUNT(DISTINCT c.id) as total_convs,
                COUNT(DISTINCT CASE WHEN c.origin = 'IDE' THEN c.id END) as ide_convs,
                COUNT(DISTINCT CASE WHEN c.origin = 'CLI' THEN c.id END) as cli_convs,
                COALESCE(COUNT(t.id), 0) as total_turns,
                COALESCE(SUM(t.input_tokens + t.cache_read_tokens + t.output_tokens), 0) as total_tok,
                COALESCE(SUM(t.cost_usd), 0.0) as cost,
                MAX(c.last_updated_at) as last_act
             FROM conversations c
             LEFT JOIN turns t ON c.id = t.conversation_id
             GROUP BY ws
             ORDER BY cost DESC"
        )?;

        let rows = stmt.query_map([], |r| {
            let ws: String = r.get(0)?;
            let alias_str: String = r.get(1)?;
            let alias = if alias_str.is_empty() { None } else { Some(alias_str) };
            let proj_name = if let Some(ref a) = alias {
                a.clone()
            } else if ws == "Sin Proyecto" {
                "Sin Proyecto".to_string()
            } else {
                Path::new(&ws)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&ws)
                    .to_string()
            };

            Ok(ProjectSummary {
                workspace_path: ws,
                project_name: proj_name,
                alias,
                total_conversations: r.get(2)?,
                ide_conversations: r.get(3)?,
                cli_conversations: r.get(4)?,
                total_turns: r.get(5)?,
                total_tokens: r.get(6)?,
                cost_usd: r.get(7)?,
                last_activity_at: r.get(8)?,
            })
        })?;

        let mut projects = Vec::new();
        for r in rows {
            projects.push(r?);
        }
        Ok(projects)
    }

    pub fn get_conversations(
        &self,
        workspace: Option<&str>,
        origin: &str,
        limit: usize,
    ) -> Result<Vec<ConversationRecord>> {
        let mut query = String::from(
            "SELECT id, parent_id, origin, db_root, parse_status, title, workspace_path, project_alias, first_seen_at, last_updated_at, last_processed_idx, total_turns, max_context_tokens
             FROM conversations WHERE 1=1"
        );

        if let Some(ws) = workspace {
            query.push_str(&format!(" AND workspace_path = '{}'", ws.replace('\'', "''")));
        }

        match origin.to_lowercase().as_str() {
            "ide" => query.push_str(" AND origin = 'IDE'"),
            "cli" => query.push_str(" AND origin = 'CLI'"),
            _ => {}
        }

        query.push_str(&format!(" ORDER BY last_updated_at DESC LIMIT {}", limit));

        let mut stmt = self.conn.prepare(&query)?;
        let rows = stmt.query_map([], |r| {
            Ok(ConversationRecord {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                origin: r.get(2)?,
                db_root: r.get(3)?,
                parse_status: r.get(4)?,
                title: r.get(5)?,
                workspace_path: r.get(6)?,
                project_alias: r.get(7)?,
                first_seen_at: r.get(8)?,
                last_updated_at: r.get(9)?,
                last_processed_idx: r.get(10)?,
                total_turns: r.get(11)?,
                max_context_tokens: r.get(12)?,
            })
        })?;

        let mut convs = Vec::new();
        for r in rows {
            convs.push(r?);
        }
        Ok(convs)
    }

    pub fn get_conversation_turns(&self, conversation_id: &str) -> Result<Vec<TurnRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, conversation_id, turn_idx, timestamp, model_name, input_tokens, cache_read_tokens, output_tokens, thinking_tokens, cost_usd
             FROM turns
             WHERE conversation_id = ?1
             ORDER BY turn_idx ASC"
        )?;

        let rows = stmt.query_map(params![conversation_id], |r| {
            Ok(TurnRecord {
                id: Some(r.get(0)?),
                conversation_id: r.get(1)?,
                turn_idx: r.get(2)?,
                timestamp: r.get(3)?,
                model_name: r.get(4)?,
                input_tokens: r.get(5)?,
                cache_read_tokens: r.get(6)?,
                output_tokens: r.get(7)?,
                thinking_tokens: r.get(8)?,
                cost_usd: r.get(9)?,
            })
        })?;

        let mut turns = Vec::new();
        for r in rows {
            turns.push(r?);
        }
        Ok(turns)
    }

    pub fn export_data(&self, format: &str, anonymize: bool) -> Result<String> {
        let mut conv_map: HashMap<String, String> = HashMap::new();
        let mut ws_map: HashMap<String, String> = HashMap::new();

        if format.eq_ignore_ascii_case("json") {
            let convs = self.get_conversations(None, "all", 10000)?;
            let mut exported_convs = Vec::new();

            for (c_idx, c) in convs.iter().enumerate() {
                let anon_id = if anonymize {
                    format!("conv_{:04}", c_idx + 1)
                } else {
                    c.id.clone()
                };

                let anon_title = if anonymize {
                    format!("Sesión {}", c_idx + 1)
                } else {
                    c.title.clone()
                };

                let anon_ws = if anonymize {
                    c.workspace_path.as_ref().map(|w| {
                        let count = ws_map.len() + 1;
                        ws_map.entry(w.clone()).or_insert_with(|| format!("/workspace/proyecto_{:02}", count)).clone()
                    })
                } else {
                    c.workspace_path.clone()
                };

                let turns = self.get_conversation_turns(&c.id)?;
                let turns_data: Vec<serde_json::Value> = turns
                    .into_iter()
                    .map(|t| {
                        serde_json::json!({
                            "turn_idx": t.turn_idx,
                            "timestamp": t.timestamp,
                            "model": t.model_name,
                            "input_tokens": t.input_tokens,
                            "cache_read_tokens": t.cache_read_tokens,
                            "output_tokens": t.output_tokens,
                            "cost_usd": t.cost_usd
                        })
                    })
                    .collect();

                exported_convs.push(serde_json::json!({
                    "id": anon_id,
                    "title": anon_title,
                    "workspace": anon_ws,
                    "origin": c.origin,
                    "total_turns": c.total_turns,
                    "max_context_tokens": c.max_context_tokens,
                    "last_updated_at": c.last_updated_at,
                    "turns": turns_data
                }));
            }

            let json_str = serde_json::to_string_pretty(&exported_convs)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
            Ok(json_str)
        } else {
            // CSV format
            let mut csv = String::from(
                "conversation_id,title,workspace,origin,turn_idx,model_name,input_tokens,cache_read_tokens,output_tokens,cost_usd,timestamp\n"
            );

            let mut stmt = self.conn.prepare(
                "SELECT c.id, c.title, c.workspace_path, c.origin, t.turn_idx, t.model_name, t.input_tokens, t.cache_read_tokens, t.output_tokens, t.cost_usd, t.timestamp
                 FROM turns t
                 JOIN conversations c ON t.conversation_id = c.id
                 ORDER BY c.last_updated_at DESC, t.turn_idx ASC"
            )?;

            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, i64>(8)?,
                    r.get::<_, f64>(9)?,
                    r.get::<_, i64>(10)?,
                ))
            })?;

            for r in rows.flatten() {
                let (cid, title, ws_opt, origin, idx, model, in_tok, cache_tok, out_tok, cost, ts) = r;
                let anon_id = if anonymize {
                    let count = conv_map.len() + 1;
                    conv_map.entry(cid).or_insert_with(|| format!("conv_{:04}", count)).clone()
                } else {
                    cid
                };

                let anon_title = if anonymize {
                    format!("Sesion {}", anon_id)
                } else {
                    title.replace('"', "\"\"")
                };

                let anon_ws = if anonymize {
                    ws_opt.map(|w| {
                        let count = ws_map.len() + 1;
                        ws_map.entry(w).or_insert_with(|| format!("/workspace/proyecto_{:02}", count)).clone()
                    }).unwrap_or_else(|| "Sin_Proyecto".to_string())
                } else {
                    ws_opt.unwrap_or_else(|| "Sin_Proyecto".to_string()).replace('"', "\"\"")
                };

                csv.push_str(&format!(
                    "\"{}\",\"{}\",\"{}\",\"{}\",{},\"{}\",{},{},{},{:.4},{}\n",
                    anon_id, anon_title, anon_ws, origin, idx, model, in_tok, cache_tok, out_tok, cost, ts
                ));
            }

            Ok(csv)
        }
    }
}

fn resolve_date_filter(
    date_filter: &str,
    custom_start: Option<i64>,
    custom_end: Option<i64>,
) -> (i64, i64, bool) {
    let now = Local::now();
    match date_filter.to_lowercase().as_str() {
        "today" => {
            let start = Local
                .with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0)
                .single()
                .unwrap_or(now);
            (start.timestamp(), i64::MAX, true)
        }
        "24h" => ((now.timestamp() - 86400), i64::MAX, true),
        "week" => ((now.timestamp() - 7 * 86400), i64::MAX, false),
        "month" => {
            // Primer día del mes actual calendario a las 00:00:00 (ej. 1 de noviembre a las 00:00:00)
            let start_of_month = Local
                .with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
                .single()
                .unwrap_or(now);
            (start_of_month.timestamp(), i64::MAX, false)
        }
        "custom" => {
            let start = custom_start.unwrap_or(0);
            let end = custom_end.unwrap_or(i64::MAX);
            let diff = end.saturating_sub(start);
            let is_hourly = diff <= (86400 * 2) && diff > 0;
            (start, end, is_hourly)
        }
        _ => (0, i64::MAX, false), // "all"
    }
}

fn extract_workspace_path(uris_json: &str) -> Option<String> {
    if uris_json.trim().is_empty() {
        return None;
    }
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(uris_json) {
        if let Some(arr) = val.as_array() {
            if let Some(first) = arr.first().and_then(|v| v.as_str()) {
                let clean = first.trim_start_matches("file://");
                return Some(clean.to_string());
            }
        }
    }
    None
}

fn parse_iso_time(time_str: &str) -> i64 {
    if let Ok(dt) = DateTime::parse_from_rfc3339(time_str) {
        return dt.timestamp();
    }
    let iso = time_str.replace(' ', "T");
    if let Ok(dt) = DateTime::parse_from_rfc3339(&iso) {
        return dt.timestamp();
    }
    chrono::Utc::now().timestamp()
}
