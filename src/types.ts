export type DateFilter = "today" | "24h" | "week" | "month" | "all" | "custom";

export interface CustomDateRange {
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
}
export type OriginFilter = "all" | "ide" | "cli";
export type TabView = "overview" | "projects" | "audit" | "settings";

export interface ConversationRecord {
  id: String;
  parent_id?: string | null;
  origin: string;
  db_root?: string | null;
  parse_status: string;
  title: string;
  workspace_path?: string | null;
  project_alias?: string | null;
  first_seen_at: number;
  last_updated_at: number;
  last_processed_idx: number;
  total_turns: number;
  max_context_tokens: number;
}

export interface TurnRecord {
  id?: number | null;
  conversation_id: string;
  turn_idx: number;
  timestamp: number;
  model_name: string;
  input_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  thinking_tokens?: number | null;
  cost_usd: number;
}

export interface ModelPrice {
  model_pattern: string;
  display_name: string;
  input_per_1m: number;
  cache_read_per_1m: number;
  output_per_1m: number;
  valid_from?: number | null;
  valid_to?: number | null;
}

export interface SyncStats {
  total_conversations: number;
  new_conversations: number;
  total_turns_processed: number;
  duration_ms: number;
}

export interface TimelinePoint {
  label: string;
  input_tokens: number;
  cache_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface ModelBreakdown {
  model_name: string;
  total_tokens: number;
  cost_usd: number;
  percentage: number;
}

export interface DashboardSummary {
  total_input_tokens: number;
  total_cache_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  cache_savings_usd: number;
  cache_hit_rate: number;
  total_conversations: number;
  total_turns: number;
  subscription_cost_usd: number;
  roi_multiplier: number;
  history: TimelinePoint[];
  models: ModelBreakdown[];
  active_session?: ConversationRecord | null;
}

export interface ProjectSummary {
  workspace_path: string;
  project_name: string;
  alias?: string | null;
  total_conversations: number;
  ide_conversations: number;
  cli_conversations: number;
  total_turns: number;
  total_tokens: number;
  cost_usd: number;
  last_activity_at: number;
}
