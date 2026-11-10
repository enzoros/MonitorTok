import React, { useState, useMemo } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  ChevronRight,
  Monitor,
  Search,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useMonitorStore } from "../store/useMonitorStore";
import type { ConversationRecord, TurnRecord } from "../types";

export type TurnSortOption =
  | "turn-asc"
  | "turn-desc"
  | "cost-desc"
  | "cost-asc"
  | "context-desc"
  | "output-desc";

const cleanModelName = (name?: string | null): string => {
  if (!name) return "Desconocido";
  let s = String(name);
  s = s.replace(/^claude-/, "Claude ");
  s = s.replace(/^gemini-/, "Gemini ");
  s = s.replace(/-medium$/, " (Thinking Med)");
  s = s.replace(/-low$/, " (Thinking Low)");
  s = s.replace(/-high$/, " (Thinking High)");
  s = s.replace(/-tiered$/, " (Adaptativo)");
  s = s.replace(/-trial$/, " (Trial)");
  s = s.replace(/-s$/, " (Small)");
  s = s.replace(/-n$/, " (Estándar)");
  s = s.replace(/flash/gi, "Flash");
  s = s.replace(/sonnet/gi, "Sonnet");
  s = s.replace(/opus/gi, "Opus");
  s = s.replace(/haiku/gi, "Haiku");
  s = s.replace(/argon/gi, "Argon");
  s = s.replace(/-/g, " ");
  return s.trim();
};

export const AuditView: React.FC = () => {
  const {
    conversations,
    selectedWorkspace,
    setSelectedWorkspace,
    selectedConversationId,
    selectedConversation,
    selectedTurns,
    selectConversation,
  } = useMonitorStore();

  const [search, setSearch] = useState("");
  const [turnSortBy, setTurnSortBy] = useState<TurnSortOption>("turn-asc");

  const sortedTurns = useMemo(() => {
    const list = [...selectedTurns];
    switch (turnSortBy) {
      case "turn-desc":
        return list.sort((a, b) => b.turn_idx - a.turn_idx);
      case "turn-asc":
        return list.sort((a, b) => a.turn_idx - b.turn_idx);
      case "cost-desc":
        return list.sort((a, b) => b.cost_usd - a.cost_usd);
      case "cost-asc":
        return list.sort((a, b) => a.cost_usd - b.cost_usd);
      case "context-desc":
        return list.sort(
          (a, b) =>
            b.input_tokens +
            b.cache_read_tokens -
            (a.input_tokens + a.cache_read_tokens)
        );
      case "output-desc":
        return list.sort((a, b) => b.output_tokens - a.output_tokens);
      default:
        return list;
    }
  }, [selectedTurns, turnSortBy]);

  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
    return num.toLocaleString();
  };

  const formatCurrency = (amount: number): string => {
    return "$" + amount.toFixed(3) + " USD";
  };

  const getContextStatus = (tokens: number) => {
    if (tokens > 120_000) {
      return {
        label: "Saturado (>120k)",
        color: "text-red-400 bg-red-500/10 border-red-500/20",
        dot: "bg-red-500",
        icon: <XCircle className="w-3.5 h-3.5 text-red-400" />,
      };
    }
    if (tokens >= 60_000) {
      return {
        label: "Medio (60k-120k)",
        color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
        dot: "bg-amber-500",
        icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
      };
    }
    return {
      label: "Óptimo (<60k)",
      color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      dot: "bg-emerald-500",
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
    };
  };

  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase();
    const titleMatch = c.title.toLowerCase().includes(q);
    const pathMatch = (c.workspace_path || "").toLowerCase().includes(q);
    return titleMatch || pathMatch;
  });

  return (
    <div className="space-y-6">
      {/* Top Header & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white tracking-tight">
              Auditoría de Conversaciones
            </h2>
            {selectedWorkspace && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-medium">
                <span>Filtro: {selectedWorkspace}</span>
                <button
                  onClick={() => setSelectedWorkspace(null)}
                  className="hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400">
            Inspector sesión por sesión con semáforo de inflación de contexto (Context Bloat)
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título o ruta..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Context Bloat Legend Banner */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 font-medium text-zinc-300">
          <span className="text-zinc-400">Semáforo de Contexto:</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            &lt; 60k: Óptimo & Rápido
          </span>
          <span className="flex items-center gap-1.5 text-amber-400">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            60k - 120k: Contexto Medio
          </span>
          <span className="flex items-center gap-1.5 text-red-400">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            &gt; 120k: Alerta de Inflación
          </span>
        </div>
      </div>

      {/* Conversations Table */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950/60 border-b border-zinc-800 text-zinc-400 uppercase text-[10px] tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">Conversación / Workspace</th>
                <th className="px-4 py-3">Origen</th>
                <th className="px-4 py-3">Turnos</th>
                <th className="px-4 py-3">Pico de Contexto</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
              {filtered.map((c: ConversationRecord) => {
                const status = getContextStatus(c.max_context_tokens);
                const isSelected = selectedConversationId === c.id;

                return (
                  <tr
                    key={c.id.toString()}
                    onClick={() => selectConversation(c.id.toString())}
                    className={`cursor-pointer hover:bg-zinc-800/40 transition-colors ${
                      isSelected ? "bg-indigo-950/20" : ""
                    }`}
                  >
                    {/* Title and Workspace */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white line-clamp-1">
                          {c.title || "Conversación sin título"}
                        </span>
                        {c.parse_status === "partial" && (
                          <span
                            title="Formato protobuf parcial detectado"
                            className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 text-[9px] font-semibold uppercase tracking-wider"
                          >
                            Parcial
                          </span>
                        )}
                        {c.parse_status === "no_data" && (
                          <span
                            title="Conversación archivada sin archivo .db local"
                            className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-500 text-[9px] font-semibold uppercase tracking-wider"
                          >
                            Sin DB
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-400 font-mono truncate max-w-sm">
                        {c.workspace_path || "Sin proyecto"}
                      </div>
                    </td>

                    {/* Origin */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 text-[10px] font-medium text-zinc-300">
                        {c.origin === "CLI" ? (
                          <Terminal className="w-3 h-3 text-cyan-400" />
                        ) : (
                          <Monitor className="w-3 h-3 text-indigo-400" />
                        )}
                        {c.origin}
                      </span>
                    </td>

                    {/* Total Turns */}
                    <td className="px-4 py-3 font-semibold text-zinc-200">
                      {c.total_turns}
                    </td>

                    {/* Max Context & Traffic Light */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${status.dot}`} />
                        <span className="font-semibold text-zinc-200">
                          {formatNumber(c.max_context_tokens)}
                        </span>
                      </div>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap font-mono text-[11px]">
                      {new Date(c.last_updated_at * 1000).toLocaleDateString()}
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-medium text-xs">
                        Inspeccionar
                        <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Lateral Drawer (Turn Inspector) */}
      {selectedConversationId && (
        <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[540px] bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          {/* Drawer Header */}
          <div className="p-5 border-b border-zinc-800 flex items-start justify-between bg-zinc-900/60">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                  {selectedConversation?.origin || "SESIÓN"}
                </span>
                <span className="text-xs text-zinc-400">
                  {selectedTurns.length} llamadas al modelo
                </span>
              </div>
              <h3 className="font-bold text-base text-white line-clamp-1">
                {selectedConversation?.title || "Inspector de Turnos"}
              </h3>
              <p className="text-xs text-zinc-400 font-mono truncate max-w-md">
                {selectedConversation?.workspace_path || selectedConversationId}
              </p>
            </div>

            <button
              onClick={() => selectConversation(null)}
              className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Chart: Context Evolution per Turn */}
          <div className="p-5 border-b border-zinc-800 bg-zinc-900/40">
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">
              Evolución de Contexto por Turno (Tokens de Entrada + Caché)
            </h4>
            <div className="h-36 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={selectedTurns.map((t) => ({
                    turn: `#${t.turn_idx}`,
                    context: t.input_tokens + t.cache_read_tokens,
                    cost: t.cost_usd,
                  }))}
                >
                  <XAxis dataKey="turn" stroke="#71717a" fontSize={10} tickLine={false} />
                  <YAxis
                    stroke="#71717a"
                    fontSize={10}
                    tickLine={false}
                    tickFormatter={(v) => formatNumber(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      borderColor: "#27272a",
                      borderRadius: "0.5rem",
                      fontSize: "0.75rem",
                    }}
                    formatter={(val: any) => [formatNumber(Number(val)), "Tokens"]}
                  />
                  <Bar dataKey="context" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Drawer List of Turns */}
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 pb-1">
              <div className="flex items-center gap-1.5">
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Detalle Turno por Turno
                </h4>
                <span className="text-[10px] text-zinc-500 font-mono">
                  ({sortedTurns.length})
                </span>
              </div>

              {/* Sorting Selector */}
              <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs shadow-sm">
                <ArrowUpDown className="w-3 h-3 text-indigo-400 shrink-0" />
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider hidden sm:inline">
                  Orden:
                </span>
                <select
                  value={turnSortBy}
                  onChange={(e) => setTurnSortBy(e.target.value as TurnSortOption)}
                  className="bg-zinc-950 text-white border border-zinc-700/80 rounded px-2 py-0.5 text-[11px] font-medium focus:outline-none focus:border-indigo-500 cursor-pointer [color-scheme:dark]"
                >
                  <option value="turn-asc" className="bg-zinc-900 text-white">
                    Cronológico (1 → {selectedTurns.length})
                  </option>
                  <option value="turn-desc" className="bg-zinc-900 text-white">
                    Más reciente ({selectedTurns.length} → 1)
                  </option>
                  <option value="cost-desc" className="bg-zinc-900 text-white">
                    Mayor Costo ($)
                  </option>
                  <option value="cost-asc" className="bg-zinc-900 text-white">
                    Menor Costo ($)
                  </option>
                  <option value="context-desc" className="bg-zinc-900 text-white">
                    Mayor Contexto (In + Caché)
                  </option>
                  <option value="output-desc" className="bg-zinc-900 text-white">
                    Mayor Salida (Output)
                  </option>
                </select>
              </div>
            </div>

            {sortedTurns.map((t: TurnRecord) => (
              <div
                key={t.turn_idx}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs space-y-2 hover:border-zinc-700/80 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white bg-zinc-800 px-1.5 py-0.5 rounded text-[11px]">
                      Turno #{t.turn_idx}
                    </span>
                    <span
                      className="text-[11px] font-semibold text-indigo-400"
                      title={t.model_name}
                    >
                      {cleanModelName(t.model_name)}
                    </span>
                  </div>
                  <span className="font-mono text-emerald-400 font-semibold">
                    {formatCurrency(t.cost_usd)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-zinc-950/60 p-2 rounded-lg text-[11px] text-zinc-300 font-mono">
                  <div>
                    <span className="text-zinc-500 block text-[10px]">Input</span>
                    {formatNumber(t.input_tokens)}
                  </div>
                  <div>
                    <span className="text-cyan-500 block text-[10px]">Caché Read</span>
                    {formatNumber(t.cache_read_tokens)}
                  </div>
                  <div>
                    <span className="text-emerald-500 block text-[10px]">Output</span>
                    {formatNumber(t.output_tokens)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
