import { create } from "zustand";
import { api } from "../services/api";
import type {
  ConversationRecord,
  CustomDateRange,
  DashboardSummary,
  DateFilter,
  ModelPrice,
  OriginFilter,
  ProjectSummary,
  SyncStats,
  TabView,
  TurnRecord,
} from "../types";

interface MonitorState {
  currentTab: TabView;
  dateFilter: DateFilter;
  customDateRange: CustomDateRange | null;
  originFilter: OriginFilter;
  subscriptionCost: number;

  dashboard: DashboardSummary | null;
  projects: ProjectSummary[];
  conversations: ConversationRecord[];
  selectedWorkspace: string | null;

  selectedConversationId: string | null;
  selectedConversation: ConversationRecord | null;
  selectedTurns: TurnRecord[];

  pricing: ModelPrice[];
  loading: boolean;
  syncing: boolean;
  lastSyncStats: SyncStats | null;

  setTab: (tab: TabView) => void;
  setDateFilter: (filter: DateFilter) => void;
  setCustomDateRange: (range: CustomDateRange | null) => void;
  setOriginFilter: (origin: OriginFilter) => void;
  setSubscriptionCost: (cost: number) => void;
  setSelectedWorkspace: (ws: string | null) => void;

  fetchDashboard: () => Promise<void>;
  fetchProjects: () => Promise<void>;
  fetchConversations: () => Promise<void>;
  selectConversation: (id: string | null) => Promise<void>;
  fetchPricing: () => Promise<void>;
  savePricing: (pricing: ModelPrice[]) => Promise<void>;
  triggerRescan: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const STORAGE_KEY_SUB_COST = "monitortok_subscription_cost";

const getSavedSubscriptionCost = (): number => {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = localStorage.getItem(STORAGE_KEY_SUB_COST);
      if (saved !== null) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 0) return val;
      }
    }
  } catch (err) {
    console.error("Failed to read subscription cost from localStorage:", err);
  }
  return 20.0;
};

export const useMonitorStore = create<MonitorState>((set, get) => ({
  currentTab: "overview",
  dateFilter: "all",
  customDateRange: null,
  originFilter: "all",
  subscriptionCost: getSavedSubscriptionCost(),

  dashboard: null,
  projects: [],
  conversations: [],
  selectedWorkspace: null,

  selectedConversationId: null,
  selectedConversation: null,
  selectedTurns: [],

  pricing: [],
  loading: false,
  syncing: false,
  lastSyncStats: null,

  setTab: (currentTab) => set({ currentTab }),

  setDateFilter: (dateFilter) => {
    set({ dateFilter });
    get().fetchDashboard();
  },

  setCustomDateRange: (customDateRange) => {
    set({ customDateRange, dateFilter: "custom" });
    get().fetchDashboard();
  },

  setOriginFilter: (originFilter) => {
    set({ originFilter });
    get().fetchDashboard();
    get().fetchConversations();
  },

  setSubscriptionCost: (subscriptionCost) => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.setItem(STORAGE_KEY_SUB_COST, subscriptionCost.toString());
      }
    } catch (err) {
      console.error("Failed to save subscription cost to localStorage:", err);
    }
    set({ subscriptionCost });
    get().fetchDashboard();
  },

  setSelectedWorkspace: (selectedWorkspace) => {
    set({ selectedWorkspace });
    get().fetchConversations();
  },

  fetchDashboard: async () => {
    try {
      const { dateFilter, originFilter, subscriptionCost, customDateRange } = get();
      let customStart: number | undefined;
      let customEnd: number | undefined;

      if (dateFilter === "custom" && customDateRange) {
        const [sYear, sMonth, sDay] = customDateRange.startDate.split("-").map(Number);
        const [eYear, eMonth, eDay] = customDateRange.endDate.split("-").map(Number);
        const startDate = new Date(sYear, sMonth - 1, sDay, 0, 0, 0);
        const endDate = new Date(eYear, eMonth - 1, eDay, 23, 59, 59);
        customStart = Math.floor(startDate.getTime() / 1000);
        customEnd = Math.floor(endDate.getTime() / 1000);
      }

      const dashboard = await api.getDashboardSummary(
        dateFilter,
        originFilter,
        subscriptionCost,
        customStart,
        customEnd
      );
      set({ dashboard });
    } catch (err) {
      console.error("[Store] fetchDashboard error:", err);
    }
  },

  fetchProjects: async () => {
    try {
      const projects = await api.getProjectsSummary();
      set({ projects });
    } catch (err) {
      console.error("[Store] fetchProjects error:", err);
    }
  },

  fetchConversations: async () => {
    try {
      const { selectedWorkspace, originFilter } = get();
      const conversations = await api.getConversations(
        selectedWorkspace || undefined,
        originFilter,
        150
      );
      set({ conversations });
    } catch (err) {
      console.error("[Store] fetchConversations error:", err);
    }
  },

  selectConversation: async (id: string | null) => {
    if (!id) {
      set({
        selectedConversationId: null,
        selectedConversation: null,
        selectedTurns: [],
      });
      return;
    }

    const conv = get().conversations.find((c) => c.id === id) || null;
    set({ selectedConversationId: id, selectedConversation: conv });

    try {
      const turns = await api.getConversationTurns(id);
      set({ selectedTurns: turns });
    } catch (err) {
      console.error("[Store] selectConversation error:", err);
    }
  },

  fetchPricing: async () => {
    try {
      const pricing = await api.getModelPricing();
      set({ pricing });
    } catch (err) {
      console.error("[Store] fetchPricing error:", err);
    }
  },

  savePricing: async (pricing: ModelPrice[]) => {
    try {
      set({ loading: true });
      await api.updateModelPricing(pricing);
      set({ pricing });
      await get().fetchDashboard();
      await get().fetchProjects();
      await get().fetchConversations();
    } catch (err) {
      console.error("[Store] savePricing error:", err);
    } finally {
      set({ loading: false });
    }
  },

  triggerRescan: async () => {
    try {
      set({ syncing: true });
      const stats = await api.triggerRescan();
      set({ lastSyncStats: stats });
      await get().refreshAll();
    } catch (err) {
      console.error("[Store] triggerRescan error:", err);
    } finally {
      set({ syncing: false });
    }
  },

  refreshAll: async () => {
    await Promise.all([
      get().fetchDashboard(),
      get().fetchProjects(),
      get().fetchConversations(),
      get().fetchPricing(),
    ]);
  },
}));
