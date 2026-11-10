use crate::models::{
    ConversationRecord, DashboardSummary, ModelPrice, ProjectSummary, SyncStats, TurnRecord,
};
use crate::roots::AntigravityRoot;
use crate::store::MetricsStore;
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AppState {
    pub store: Arc<Mutex<MetricsStore>>,
    pub roots: Vec<AntigravityRoot>,
}

#[tauri::command]
pub fn get_dashboard_summary(
    state: State<'_, AppState>,
    filter: Option<String>,
    origin: Option<String>,
    subscription_cost: Option<f64>,
    custom_start: Option<i64>,
    custom_end: Option<i64>,
) -> Result<DashboardSummary, String> {
    let date_filter = filter.unwrap_or_else(|| "all".to_string());
    let origin_filter = origin.unwrap_or_else(|| "all".to_string());
    let sub_cost = subscription_cost.unwrap_or(20.0);

    let store = state.store.lock().map_err(|e| e.to_string())?;
    store
        .get_dashboard_summary(
            &date_filter,
            &origin_filter,
            sub_cost,
            custom_start,
            custom_end,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_projects_summary(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.get_projects_summary().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_conversations(
    state: State<'_, AppState>,
    workspace: Option<String>,
    origin: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ConversationRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let orig = origin.unwrap_or_else(|| "all".to_string());
    let lim = limit.unwrap_or(100);
    store
        .get_conversations(workspace.as_deref(), &orig, lim)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_conversation_turns(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<TurnRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store
        .get_conversation_turns(&conversation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_model_pricing(state: State<'_, AppState>) -> Result<Vec<ModelPrice>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.get_pricing().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_model_pricing(
    state: State<'_, AppState>,
    pricing: Vec<ModelPrice>,
) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.update_pricing(pricing).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn trigger_rescan(state: State<'_, AppState>) -> Result<SyncStats, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.sync_all(&state.roots).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_data(
    state: State<'_, AppState>,
    format: Option<String>,
    anonymize: Option<bool>,
) -> Result<String, String> {
    let fmt = format.unwrap_or_else(|| "csv".to_string());
    let anon = anonymize.unwrap_or(false);
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.export_data(&fmt, anon).map_err(|e| e.to_string())
}
