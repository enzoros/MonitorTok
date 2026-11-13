use crate::roots::AntigravityRoot;
use crate::store::MetricsStore;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};

const POLL_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: Option<SystemTime>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct DbStamp {
    db: FileStamp,
    wal: Option<FileStamp>,
}

fn read_file_stamp(path: &Path) -> Option<FileStamp> {
    let meta = std::fs::metadata(path).ok()?;
    Some(FileStamp {
        len: meta.len(),
        modified: meta.modified().ok(),
    })
}

fn read_db_stamp(db_path: &Path) -> Option<DbStamp> {
    let db = read_file_stamp(db_path)?;
    if db.len == 0 {
        return None;
    }
    let mut wal_os = db_path.as_os_str().to_os_string();
    wal_os.push("-wal");
    let wal = read_file_stamp(Path::new(&wal_os));
    Some(DbStamp { db, wal })
}

fn collect_db_stamps(roots: &[AntigravityRoot]) -> HashMap<PathBuf, DbStamp> {
    let mut stamps = HashMap::new();
    for root in roots {
        let conv_dir = root.conversations_dir();
        if let Ok(entries) = std::fs::read_dir(conv_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("db") {
                    if let Some(stamp) = read_db_stamp(&path) {
                        stamps.insert(path, stamp);
                    }
                }
            }
        }
    }
    stamps
}

pub fn start_file_watcher(
    app: AppHandle,
    store: Arc<Mutex<MetricsStore>>,
    roots: Vec<AntigravityRoot>,
) {
    std::thread::spawn(move || {
        // Seed initial file stamps so we only process changes occurring after startup
        let mut known_stamps = collect_db_stamps(&roots);
        println!(
            "[Poller] Periodic sync started (interval: {}s, tracking {} DBs)",
            POLL_INTERVAL.as_secs(),
            known_stamps.len()
        );

        loop {
            std::thread::sleep(POLL_INTERVAL);

            let current_stamps = collect_db_stamps(&roots);
            let mut has_new_db = false;
            let mut changed_dbs = Vec::new();

            for (path, stamp) in &current_stamps {
                match known_stamps.get(path) {
                    None => {
                        has_new_db = true;
                        changed_dbs.push(path.clone());
                    }
                    Some(prev) if prev != stamp => {
                        changed_dbs.push(path.clone());
                    }
                    _ => {}
                }
            }

            known_stamps = current_stamps;

            if changed_dbs.is_empty() {
                continue;
            }

            let mut store_guard = match store.lock() {
                Ok(g) => g,
                Err(e) => {
                    eprintln!("[Poller] Poisoned mutex: {}", e);
                    continue;
                }
            };

            if has_new_db {
                // New conversation DB detected: run incremental sync_all so metadata/titles are registered
                match store_guard.sync_all(&roots) {
                    Ok(stats) => {
                        if stats.total_turns_processed > 0 || stats.new_conversations > 0 {
                            println!(
                                "[Poller] Synced {} new turns ({} new convs) in {}ms",
                                stats.total_turns_processed,
                                stats.new_conversations,
                                stats.duration_ms
                            );
                            let _ = app.emit(
                                "metrics://updated",
                                serde_json::json!({
                                    "full_sync": true,
                                    "new_turns": stats.total_turns_processed
                                }),
                            );
                        }
                    }
                    Err(e) => eprintln!("[Poller] Error in sync_all: {}", e),
                }
            } else {
                let mut total_new_turns = 0usize;
                for db_path in changed_dbs {
                    match store_guard.sync_single_db(&roots, &db_path) {
                        Ok(new_turns) => {
                            total_new_turns += new_turns;
                        }
                        Err(e) => {
                            eprintln!("[Poller] Error syncing {}: {}", db_path.display(), e);
                        }
                    }
                }

                if total_new_turns > 0 {
                    println!("[Poller] Synced {} new turns", total_new_turns);
                    let _ = app.emit(
                        "metrics://updated",
                        serde_json::json!({
                            "new_turns": total_new_turns
                        }),
                    );
                }
            }
        }
    });
}
