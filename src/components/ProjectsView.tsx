import React, { useState } from "react";
import {
  FolderGit2,
  Terminal,
  Monitor,
  Coins,
  Cpu,
  ArrowUpRight,
  Search,
} from "lucide-react";
import { useMonitorStore } from "../store/useMonitorStore";
import type { ProjectSummary } from "../types";

export const ProjectsView: React.FC = () => {
  const { projects, setSelectedWorkspace, setTab } = useMonitorStore();
  const [search, setSearch] = useState("");

  const formatNumber = (num: number): string => {
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + "B";
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
    return num.toLocaleString();
  };

  const formatCurrency = (amount: number): string => {
    return "$" + amount.toFixed(2) + " USD";
  };

  const filtered = projects.filter((p) => {
    const q = search.toLowerCase();
    return (
      p.project_name.toLowerCase().includes(q) ||
      p.workspace_path.toLowerCase().includes(q)
    );
  });

  const handleOpenProjectAudit = (workspacePath: string) => {
    setSelectedWorkspace(workspacePath === "Sin Proyecto" ? null : workspacePath);
    setTab("audit");
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Proyectos & Espacios de Trabajo
          </h2>
          <p className="text-xs text-zinc-400">
            Consumo consolidado de tokens, llamadas y costos por repositorio detectado
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o ruta..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((proj: ProjectSummary) => (
          <div
            key={proj.workspace_path}
            className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 hover:border-zinc-700 transition-all flex flex-col justify-between group"
          >
            <div>
              {/* Card Header */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <FolderGit2 className="w-5 h-5" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    title="Sesiones en Antigravity IDE"
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 text-[10px] font-medium text-zinc-300"
                  >
                    <Monitor className="w-3 h-3 text-zinc-400" />
                    {proj.ide_conversations}
                  </span>
                  <span
                    title="Sesiones en agy CLI"
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 text-[10px] font-medium text-cyan-400"
                  >
                    <Terminal className="w-3 h-3 text-cyan-400" />
                    {proj.cli_conversations}
                  </span>
                </div>
              </div>

              {/* Title and Path */}
              <h3 className="font-semibold text-base text-white group-hover:text-indigo-300 transition-colors">
                {proj.project_name}
              </h3>
              <p
                title={proj.workspace_path}
                className="text-xs text-zinc-400 truncate mt-0.5 font-mono"
              >
                {proj.workspace_path}
              </p>
            </div>

            {/* Metrics */}
            <div className="mt-5 pt-4 border-t border-zinc-800/80 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-zinc-950/50 rounded-xl p-2.5 border border-zinc-800/50">
                  <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] mb-1">
                    <Cpu className="w-3 h-3 text-indigo-400" />
                    Tokens
                  </div>
                  <div className="font-bold text-zinc-200">
                    {formatNumber(proj.total_tokens)}
                  </div>
                </div>

                <div className="bg-zinc-950/50 rounded-xl p-2.5 border border-zinc-800/50">
                  <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] mb-1">
                    <Coins className="w-3 h-3 text-emerald-400" />
                    Costo API
                  </div>
                  <div className="font-bold text-emerald-400">
                    {formatCurrency(proj.cost_usd)}
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={() => handleOpenProjectAudit(proj.workspace_path)}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-zinc-800/70 hover:bg-indigo-600 text-xs font-medium text-zinc-300 hover:text-white transition-colors"
              >
                <span>Ver {proj.total_conversations} conversaciones</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-zinc-500 text-xs">
          No se encontraron proyectos con ese criterio de búsqueda.
        </div>
      )}
    </div>
  );
};
