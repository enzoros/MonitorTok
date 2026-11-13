import React, { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Navbar } from "./components/Navbar";
import { OverviewView } from "./components/OverviewView";
import { ProjectsView } from "./components/ProjectsView";
import { AuditView } from "./components/AuditView";
import { SettingsView } from "./components/SettingsView";
import { useMonitorStore } from "./store/useMonitorStore";
import "./App.css";

export const App: React.FC = () => {
  const { currentTab, refreshAll, refreshLiveMetrics } = useMonitorStore();

  useEffect(() => {
    // 1. Initial load
    refreshAll();

    // 2. Periodic sync event subscription (skip work while window is hidden)
    let pendingRefresh = false;
    let unlistenFn: (() => void) | undefined;

    listen("metrics://updated", (event) => {
      console.log("[Sync Event] metrics://updated:", event.payload);
      if (document.hidden) {
        pendingRefresh = true;
      } else {
        refreshLiveMetrics();
      }
    }).then((fn) => {
      unlistenFn = fn;
    });

    const handleVisibilityChange = () => {
      if (!document.hidden && pendingRefresh) {
        pendingRefresh = false;
        refreshLiveMetrics();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (unlistenFn) unlistenFn();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto p-5 sm:p-6 lg:p-8">
        {currentTab === "overview" && <OverviewView />}
        {currentTab === "projects" && <ProjectsView />}
        {currentTab === "audit" && <AuditView />}
        {currentTab === "settings" && <SettingsView />}
      </main>

      <footer className="border-t border-zinc-900 py-3 px-5 text-center text-[11px] text-zinc-600">
        MonitorTok — Antigravity & agy CLI Zero-Config Token Monitor (Linux)
      </footer>
    </div>
  );
};

export default App;
