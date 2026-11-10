import React from "react";
import {
  Activity,
  Layers,
  FolderGit2,
  ListFilter,
  Settings,
  RefreshCw,
  Terminal,
  Monitor,
} from "lucide-react";
import { useMonitorStore } from "../store/useMonitorStore";
import type { OriginFilter, TabView } from "../types";

export const Navbar: React.FC = () => {
  const {
    currentTab,
    setTab,
    originFilter,
    setOriginFilter,
    syncing,
    triggerRescan,
  } = useMonitorStore();

  const tabs: {
    id: TabView;
    label: string;
    fullLabel: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "overview",
      label: "Dashboard",
      fullLabel: "Dashboard",
      icon: <Activity className="w-4 h-4 shrink-0" />,
    },
    {
      id: "projects",
      label: "Proyectos",
      fullLabel: "Proyectos",
      icon: <FolderGit2 className="w-4 h-4 shrink-0" />,
    },
    {
      id: "audit",
      label: "Auditoría",
      fullLabel: "Auditoría & Chats",
      icon: <ListFilter className="w-4 h-4 shrink-0" />,
    },
    {
      id: "settings",
      label: "Ajustes",
      fullLabel: "Tarifas & Ajustes",
      icon: <Settings className="w-4 h-4 shrink-0" />,
    },
  ];

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-40 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 min-w-0">
      {/* Brand & Live status */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
          <Layers className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="font-bold text-sm sm:text-base tracking-tight text-white whitespace-nowrap">
              MonitorTok
            </h1>
            <span className="hidden md:inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 whitespace-nowrap">
              Antigravity & agy
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span>Monitoreo en vivo</span>
            <span className="hidden lg:inline text-zinc-500">(Linux)</span>
          </p>
        </div>
      </div>

      {/* Main navigation tabs */}
      <nav className="flex items-center bg-zinc-900/90 border border-zinc-800 rounded-xl p-1 gap-1 shrink-0">
        {tabs.map((tab) => {
          const active = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-1.5 px-2.5 lg:px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                active
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
              }`}
            >
              {tab.icon}
              <span className="hidden xl:inline">{tab.fullLabel}</span>
              <span className="xl:hidden">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Origin filter & Rescan action */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Origin Switcher */}
        <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-xs shrink-0">
          {(
            [
              { id: "all", label: "Todo" },
              { id: "ide", label: "IDE", icon: <Monitor className="w-3 h-3 shrink-0" /> },
              {
                id: "cli",
                label: "CLI",
                fullLabel: "CLI (agy)",
                icon: <Terminal className="w-3 h-3 shrink-0" />,
              },
            ] as {
              id: OriginFilter;
              label: string;
              fullLabel?: string;
              icon?: React.ReactNode;
            }[]
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => setOriginFilter(item.id)}
              className={`flex items-center gap-1 px-2 lg:px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                originFilter === item.id
                  ? "bg-indigo-600 text-white shadow"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {item.icon}
              {item.fullLabel ? (
                <>
                  <span className="hidden xl:inline">{item.fullLabel}</span>
                  <span className="xl:hidden">{item.label}</span>
                </>
              ) : (
                <span>{item.label}</span>
              )}
            </button>
          ))}
        </div>

        {/* Rescan Button */}
        <button
          onClick={triggerRescan}
          disabled={syncing}
          title="Re-escanear bases de datos de Antigravity"
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs font-medium text-zinc-300 hover:text-white whitespace-nowrap transition-all disabled:opacity-50 shrink-0"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 shrink-0 ${
              syncing ? "animate-spin text-indigo-400" : ""
            }`}
          />
          <span className="hidden sm:inline">
            {syncing ? "Sincronizando..." : "Sincronizar"}
          </span>
        </button>
      </div>
    </header>
  );
};
