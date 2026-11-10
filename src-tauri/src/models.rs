use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationRecord {
    pub id: String,
    pub parent_id: Option<String>,
    pub origin: String,
    pub db_root: Option<String>,
    pub parse_status: String,
    pub title: String,
    pub workspace_path: Option<String>,
    pub project_alias: Option<String>,
    pub first_seen_at: i64,
    pub last_updated_at: i64,
    pub last_processed_idx: i64,
    pub total_turns: i64,
    pub max_context_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnRecord {
    pub id: Option<i64>,
    pub conversation_id: String,
    pub turn_idx: i64,
    pub timestamp: i64,
    pub model_name: String,
    pub input_tokens: i64,
    pub cache_read_tokens: i64,
    pub output_tokens: i64,
    pub thinking_tokens: Option<i64>,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPrice {
    pub model_pattern: String,
    pub display_name: String,
    pub input_per_1m: f64,
    pub cache_read_per_1m: f64,
    pub output_per_1m: f64,
    #[serde(default)]
    pub valid_from: Option<i64>,
    #[serde(default)]
    pub valid_to: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncStats {
    pub total_conversations: usize,
    pub new_conversations: usize,
    pub total_turns_processed: usize,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelinePoint {
    pub label: String,
    pub input_tokens: i64,
    pub cache_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelBreakdown {
    pub model_name: String,
    pub total_tokens: i64,
    pub cost_usd: f64,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSummary {
    pub total_input_tokens: i64,
    pub total_cache_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cost_usd: f64,
    pub cache_savings_usd: f64,
    pub cache_hit_rate: f64,
    pub total_conversations: i64,
    pub total_turns: i64,
    pub subscription_cost_usd: f64,
    pub roi_multiplier: f64,
    pub history: Vec<TimelinePoint>,
    pub models: Vec<ModelBreakdown>,
    pub active_session: Option<ConversationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub workspace_path: String,
    pub project_name: String,
    pub alias: Option<String>,
    pub total_conversations: i64,
    pub ide_conversations: i64,
    pub cli_conversations: i64,
    pub total_turns: i64,
    pub total_tokens: i64,
    pub cost_usd: f64,
    pub last_activity_at: i64,
}
