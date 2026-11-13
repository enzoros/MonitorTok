import { invoke } from "@tauri-apps/api/core";
import type {
  ConversationRecord,
  DashboardSummary,
  DateFilter,
  ModelPrice,
  OriginFilter,
  ProjectSummary,
  SyncStats,
  TurnRecord,
} from "../types";

export const api = {
  getDashboardSummary: (
    filter: DateFilter = "all",
    origin: OriginFilter = "all",
    subscriptionCost: number = 20.0,
    customStart?: number,
    customEnd?: number
  ): Promise<DashboardSummary> => {
    return invoke<DashboardSummary>("get_dashboard_summary", {
      filter,
      origin,
      subscriptionCost,
      customStart,
      customEnd,
    });
  },

  getProjectsSummary: (): Promise<ProjectSummary[]> => {
    return invoke<ProjectSummary[]>("get_projects_summary");
  },

  getConversations: (
    workspace?: string,
    origin: OriginFilter = "all",
    limit: number = 100
  ): Promise<ConversationRecord[]> => {
    return invoke<ConversationRecord[]>("get_conversations", {
      workspace: workspace || null,
      origin,
      limit,
    });
  },

  getConversationTurns: (conversationId: string): Promise<TurnRecord[]> => {
    return invoke<TurnRecord[]>("get_conversation_turns", {
      conversationId,
    });
  },

  getModelPricing: (): Promise<ModelPrice[]> => {
    return invoke<ModelPrice[]>("get_model_pricing");
  },

  getUnmatchedModels: (): Promise<string[]> => {
    return invoke<string[]>("get_unmatched_models");
  },

  updateModelPricing: (pricing: ModelPrice[]): Promise<void> => {
    return invoke<void>("update_model_pricing", { pricing });
  },

  triggerRescan: (): Promise<SyncStats> => {
    return invoke<SyncStats>("trigger_rescan");
  },

  exportData: (format: "csv" | "json", anonymize: boolean): Promise<string> => {
    return invoke<string>("export_data", { format, anonymize });
  },
};
