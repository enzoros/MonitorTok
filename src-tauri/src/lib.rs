pub mod commands;
pub mod db_reader;
pub mod models;
pub mod pricing;
pub mod proto_parser;
pub mod roots;
pub mod store;
pub mod watcher;

use commands::AppState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

pub fn get_default_db_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join(".local/share/monitortok")
        .join("app_metrics.sqlite")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let roots = roots::detect_roots();
    let db_path = get_default_db_path();
    let metrics_store = match store::MetricsStore::new(&db_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[Fatal] Failed to init MetricsStore: {}", e);
            return;
        }
    };

    let store_arc = Arc::new(Mutex::new(metrics_store));
    let store_for_watcher = Arc::clone(&store_arc);
    let store_for_init_sync = Arc::clone(&store_arc);
    let roots_for_watcher = roots.clone();
    let roots_for_init_sync = roots.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            store: store_arc,
            roots,
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_dashboard_summary,
            commands::get_projects_summary,
            commands::get_conversations,
            commands::get_conversation_turns,
            commands::get_model_pricing,
            commands::get_unmatched_models,
            commands::update_model_pricing,
            commands::trigger_rescan,
            commands::export_data,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Setup Linux System Tray
            let show_i = MenuItem::with_id(app, "show", "Abrir MonitorTok", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            if let Some(icon) = app.default_window_icon() {
                let _ = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .tooltip("MonitorTok - Antigravity Token Monitor")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app);
            }

            // 1. Initial background sync so window is not blocked
            let app_handle_sync = app_handle.clone();
            std::thread::spawn(move || {
                println!("[Init] Starting initial background sync...");
                if let Ok(mut store) = store_for_init_sync.lock() {
                    match store.sync_all(&roots_for_init_sync) {
                        Ok(stats) => {
                            println!(
                                "[Init] Background sync complete: {} convs, {} turns in {}ms",
                                stats.total_conversations,
                                stats.total_turns_processed,
                                stats.duration_ms
                            );
                            use tauri::Emitter;
                            let _ = app_handle_sync.emit("metrics://updated", serde_json::json!({ "full_sync": true }));
                        }
                        Err(e) => eprintln!("[Init] Background sync error: {}", e),
                    }
                }
            });

            // 2. Start File Watcher on conversations/
            watcher::start_file_watcher(app_handle, store_for_watcher, roots_for_watcher);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_reader_non_existent_file() {
        let fake_path = PathBuf::from("/tmp/non_existent_db_123456.db");
        assert!(!fake_path.exists());
        let res = db_reader::SafeDbReader::open_readonly(&fake_path);
        assert!(res.is_err());
        assert!(!fake_path.exists());
    }

    #[test]
    fn test_detect_roots() {
        let roots = roots::detect_roots();
        println!("Detected roots: {:?}", roots);
        assert!(!roots.is_empty(), "Should detect at least one Antigravity root");
        for r in &roots {
            assert!(r.path.exists(), "Root path must exist");
            assert!(r.summaries_db().exists(), "summaries_db must exist");
        }
    }

    #[test]
    fn test_pricing_engine_calculations() {
        let pricing = pricing::default_pricing();
        let engine = pricing::PricingEngine::new(pricing);

        let (cost, name) = engine.calculate_cost("gemini-3.8-flash-n", 1_000_000, 0, 1_000_000);
        assert!(name.contains("Flash"));
        assert!((cost - 4.50).abs() < 1e-4);

        let (cost, name) = engine.calculate_cost("gemini-3.5-flash-lite", 1_000_000, 0, 1_000_000);
        assert!(name.contains("Flash-Lite"));
        assert!((cost - 0.50).abs() < 1e-4);

        let (cost, name) = engine.calculate_cost("claude-sonnet-5-5-medium", 1_000_000, 1_000_000, 1_000_000);
        assert!(name.contains("Sonnet"));
        assert!((cost - 18.30).abs() < 1e-4);

        let (cost, name) = engine.calculate_cost("unknown-future-model", 1_000_000, 0, 1_000_000);
        assert!(name.contains("Estándar"));
        assert!((cost - 5.00).abs() < 1e-4);
    }

    #[test]
    fn test_temporal_pricing_engine() {
        let pricing = pricing::default_pricing();
        let engine = pricing::PricingEngine::new(pricing);

        // 1. Argon before Dec 1, 2026 (Promo rate: $2 in + $10 out = $12 total)
        let (cost_promo, name_promo) = engine.calculate_cost_at("gemini-4-argon", Some(1794288000), 1_000_000, 0, 1_000_000);
        assert!(name_promo.contains("Promo"));
        assert!((cost_promo - 12.00).abs() < 1e-4);

        // 2. Argon on/after Dec 1, 2026 (Standard rate: $4 in + $20 out = $24 total)
        let (cost_std, name_std) = engine.calculate_cost_at("gemini-4-argon", Some(1796500000), 1_000_000, 0, 1_000_000);
        assert!(name_std.contains("Oficial"));
        assert!((cost_std - 24.00).abs() < 1e-4);

        // 3. Flash before Jan 1, 2027 (Promo rate: $0.75 in + $3.75 out = $4.50 total)
        let (cost_flash_promo, name_flash_promo) = engine.calculate_cost_at("gemini-3.8-flash-n", Some(1794288000), 1_000_000, 0, 1_000_000);
        assert!(name_flash_promo.contains("Promo 2026"));
        assert!((cost_flash_promo - 4.50).abs() < 1e-4);

        // 4. Flash on/after Jan 1, 2027 (Standard rate: $1.50 in + $7.50 out = $9.00 total)
        let (cost_flash_std, name_flash_std) = engine.calculate_cost_at("gemini-3.8-flash-n", Some(1799000000), 1_000_000, 0, 1_000_000);
        assert!(name_flash_std.contains("Estándar 2027"));
        assert!((cost_flash_std - 9.00).abs() < 1e-4);
    }

    #[test]
    fn test_phase_1_full_sync_and_benchmark() {
        let roots = roots::detect_roots();
        assert!(!roots.is_empty());

        let mut store = store::MetricsStore::in_memory().expect("Failed to init in-memory store");

        let stats = store.sync_all(&roots).expect("Full sync failed");
        println!(
            "Phase 1 Initial Sync: {} conversations, {} turns in {} ms",
            stats.total_conversations, stats.total_turns_processed, stats.duration_ms
        );

        assert!(stats.total_conversations > 100);
        assert!(stats.total_turns_processed > 5000);
        assert!(stats.duration_ms < 6000);

        let inc_stats = store.sync_all(&roots).expect("Incremental sync failed");
        println!(
            "Phase 1 Incremental Sync: {} turns in {} ms",
            inc_stats.total_turns_processed, inc_stats.duration_ms
        );
        // During an active chat session, at most 1-2 concurrent live turns may arrive between scans
        assert!(inc_stats.total_turns_processed <= 2);
        assert!(inc_stats.duration_ms < 2000);
    }

    #[test]
    fn test_phase_2_ipc_queries_and_dashboard_summary() {
        let roots = roots::detect_roots();
        let mut store = store::MetricsStore::in_memory().expect("Failed to init store");
        store.sync_all(&roots).expect("Sync failed");

        // 1. Dashboard summary "all"
        let summary = store.get_dashboard_summary("all", "all", 20.0, None, None).unwrap();
        assert!(summary.total_turns > 5000);
        assert!(summary.total_cost_usd > 50.0);
        assert!(summary.cache_hit_rate >= 0.0 && summary.cache_hit_rate <= 100.0);
        assert!(summary.roi_multiplier > 1.0);
        assert!(!summary.history.is_empty());
        assert!(!summary.models.is_empty());

        println!(
            "Dashboard All: Tokens(In: {}, Cache: {}, Out: {}) | Cost: ${:.2} | Savings: ${:.2} | Cache Hit: {:.1}% | ROI: {:.1}x",
            summary.total_input_tokens,
            summary.total_cache_tokens,
            summary.total_output_tokens,
            summary.total_cost_usd,
            summary.cache_savings_usd,
            summary.cache_hit_rate,
            summary.roi_multiplier
        );

        // 2. Dashboard summary "today" and origin filter
        let summary_cli = store.get_dashboard_summary("all", "cli", 20.0, None, None).unwrap();
        println!("Dashboard CLI only turns: {}", summary_cli.total_turns);
        assert!(summary_cli.total_turns > 0, "CLI turns must exist");

        // 3. Projects summary
        let projects = store.get_projects_summary().unwrap();
        assert!(!projects.is_empty());
        let orbit = projects.iter().find(|p| p.workspace_path.contains("OrbitDesign"));
        assert!(orbit.is_some(), "OrbitDesign must be in projects");
        let orbit_proj = orbit.unwrap();
        println!(
            "Project OrbitDesign: {} convs (IDE: {}, CLI: {}), {} turns, ${:.2}",
            orbit_proj.total_conversations,
            orbit_proj.ide_conversations,
            orbit_proj.cli_conversations,
            orbit_proj.total_turns,
            orbit_proj.cost_usd
        );

        // 4. Conversations view
        let convs = store.get_conversations(None, "all", 10).unwrap();
        assert_eq!(convs.len(), 10);
        let first_id = &convs[0].id;

        // 5. Turns view
        let turns = store.get_conversation_turns(first_id).unwrap();
        println!("Conversation {} has {} turns", first_id, turns.len());
    }

    #[test]
    fn test_phase_2_pricing_update_recalculates_costs() {
        let roots = roots::detect_roots();
        let mut store = store::MetricsStore::in_memory().expect("Failed to init store");
        store.sync_all(&roots).expect("Sync failed");

        let summary_before = store.get_dashboard_summary("all", "all", 20.0, None, None).unwrap();
        let cost_before = summary_before.total_cost_usd;

        // Double the price of flash models
        let mut custom_prices = store.get_pricing().unwrap();
        for p in &mut custom_prices {
            if p.model_pattern.contains("flash") {
                p.output_per_1m *= 5.0;
            }
        }

        store.update_pricing(custom_prices).unwrap();
        let summary_after = store.get_dashboard_summary("all", "all", 20.0, None, None).unwrap();
        let cost_after = summary_after.total_cost_usd;

        println!("Cost before: ${:.2}, Cost after tariff increase: ${:.2}", cost_before, cost_after);
        assert!(cost_after > cost_before, "Updating tariffs must recalculate costs");
    }

    #[test]
    fn test_custom_date_range_filtering() {
        let roots = roots::detect_roots();
        let mut store = store::MetricsStore::in_memory().expect("Failed to init store");
        store.sync_all(&roots).expect("Sync failed");

        let all_summary = store.get_dashboard_summary("all", "all", 20.0, None, None).unwrap();

        // Specific 2-day range: Oct 28 00:00:00 to Oct 29 23:59:59 (1761609600 to 1761782399 approx)
        // Using fixed timestamps from historical data: 24h window
        let end_ts = chrono::Local::now().timestamp();
        let start_ts = end_ts - 2 * 86400;

        let custom_summary = store
            .get_dashboard_summary("custom", "all", 20.0, Some(start_ts), Some(end_ts))
            .expect("Custom range query failed");

        println!(
            "Custom 2-Day Range: {} turns, ${:.2} (vs All Time: {} turns, ${:.2})",
            custom_summary.total_turns,
            custom_summary.total_cost_usd,
            all_summary.total_turns,
            all_summary.total_cost_usd
        );

        assert!(custom_summary.total_turns <= all_summary.total_turns);
        assert!(custom_summary.total_cost_usd <= all_summary.total_cost_usd);
    }

    #[test]
    fn test_phase_4_export_data_csv_and_json_with_anonymization() {
        let roots = roots::detect_roots();
        let mut store = store::MetricsStore::in_memory().expect("Failed to init store");
        store.sync_all(&roots).expect("Sync failed");

        // 1. Export CSV anonymized
        let csv = store.export_data("csv", true).unwrap();
        assert!(csv.starts_with("conversation_id,title,workspace"));
        assert!(csv.contains("conv_0001"));
        assert!(csv.contains("/workspace/proyecto_01"));
        // Ensure real path like /home/enzo is not in the anonymized output!
        assert!(!csv.contains("/home/enzo"));

        // 2. Export JSON non-anonymized
        let json_str = store.export_data("json", false).unwrap();
        assert!(json_str.contains("OrbitDesign"));
        assert!(json_str.contains("turns"));
    }
}
