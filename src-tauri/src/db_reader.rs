use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use std::time::Duration;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DbReaderError {
    #[error("File does not exist: {0}")]
    NotFound(String),
    #[error("File is empty (0 bytes): {0}")]
    EmptyFile(String),
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct ConversationSummary {
    pub conversation_id: String,
    pub title: String,
    pub workspace_uris: String,
    pub source: String,
    pub agent_name: String,
    pub parent_conversation_id: String,
    pub last_modified_time: String,
    pub step_count: i64,
}

pub struct SafeDbReader;

impl SafeDbReader {
    pub fn open_readonly(path: &Path) -> Result<Connection, DbReaderError> {
        if !path.exists() {
            return Err(DbReaderError::NotFound(path.display().to_string()));
        }
        let meta = std::fs::metadata(path)?;
        if meta.len() == 0 {
            return Err(DbReaderError::EmptyFile(path.display().to_string()));
        }

        let uri = format!("file:{}?mode=ro", path.to_string_lossy());
        let conn = Connection::open_with_flags(
            &uri,
            OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        conn.busy_timeout(Duration::from_millis(1000))?;
        Ok(conn)
    }

    pub fn read_summaries(path: &Path) -> Result<Vec<ConversationSummary>, DbReaderError> {
        let conn = Self::open_readonly(path)?;
        let mut stmt = conn.prepare(
            "SELECT conversation_id, title, workspace_uris, source, agent_name, parent_conversation_id, last_modified_time, step_count
             FROM conversation_summaries"
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(ConversationSummary {
                conversation_id: row.get(0)?,
                title: row.get(1)?,
                workspace_uris: row.get(2)?,
                source: row.get(3)?,
                agent_name: row.get(4)?,
                parent_conversation_id: row.get(5)?,
                last_modified_time: row.get(6)?,
                step_count: row.get(7)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }

    pub fn read_gen_metadata(path: &Path) -> Result<Vec<(i64, Vec<u8>)>, DbReaderError> {
        let conn = Self::open_readonly(path)?;
        let mut stmt = conn.prepare("SELECT idx, data FROM gen_metadata ORDER BY idx ASC")?;
        let rows = stmt.query_map([], |row| {
            let idx: i64 = row.get(0)?;
            let data: Vec<u8> = row.get(1)?;
            Ok((idx, data))
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }
}
