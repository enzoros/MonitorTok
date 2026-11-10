use crate::roots::AntigravityRoot;
use crate::store::MetricsStore;
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub fn start_file_watcher(
    app: AppHandle,
    store: Arc<Mutex<MetricsStore>>,
    roots: Vec<AntigravityRoot>,
) {
    std::thread::spawn(move || {
        let (tx, rx) = channel();

        let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[Watcher] Failed to create recommended watcher: {}", e);
                return;
            }
        };

        for root in &roots {
            let conv_dir = root.conversations_dir();
            if conv_dir.exists() {
                if let Err(e) = watcher.watch(&conv_dir, RecursiveMode::NonRecursive) {
                    eprintln!("[Watcher] Failed to watch {}: {}", conv_dir.display(), e);
                } else {
                    println!("[Watcher] Watching directory: {}", conv_dir.display());
                }
            }
        }

        let debounce_duration = Duration::from_millis(400);
        let mut pending_files: HashMap<PathBuf, Instant> = HashMap::new();

        loop {
            // Check for incoming filesystem events with timeout
            while let Ok(res) = rx.recv_timeout(Duration::from_millis(100)) {
                if let Ok(event) = res {
                    if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                        for path in event.paths {
                            if is_conversation_file(&path) {
                                let target_db = get_base_db_path(&path);
                                pending_files.insert(target_db, Instant::now());
                            }
                        }
                    }
                }
            }

            // Process debounced files
            let now = Instant::now();
            let mut ready_files = Vec::new();

            pending_files.retain(|path, last_time| {
                if now.duration_since(*last_time) >= debounce_duration {
                    ready_files.push(path.clone());
                    false
                } else {
                    true
                }
            });

            for db_path in ready_files {
                let mut store_guard = match store.lock() {
                    Ok(g) => g,
                    Err(e) => {
                        eprintln!("[Watcher] Poisoned mutex: {}", e);
                        continue;
                    }
                };

                match store_guard.sync_single_db(&roots, &db_path) {
                    Ok(new_turns) => {
                        if new_turns > 0 {
                            println!(
                                "[Watcher] Synced {} new turns for {}",
                                new_turns,
                                db_path.display()
                            );
                            let conv_id = db_path
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or_default();

                            let _ = app.emit(
                                "metrics://updated",
                                serde_json::json!({
                                    "conversation_id": conv_id,
                                    "new_turns": new_turns
                                }),
                            );
                        }
                    }
                    Err(e) => {
                        eprintln!("[Watcher] Error syncing {}: {}", db_path.display(), e);
                    }
                }
            }
        }
    });
}

fn is_conversation_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or_default();
    name.ends_with(".db") || name.ends_with(".db-wal") || name.ends_with(".db-shm")
}

fn get_base_db_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if s.ends_with(".db-wal") {
        PathBuf::from(s.trim_end_matches("-wal"))
    } else if s.ends_with(".db-shm") {
        PathBuf::from(s.trim_end_matches("-shm"))
    } else {
        path.to_path_buf()
    }
}
