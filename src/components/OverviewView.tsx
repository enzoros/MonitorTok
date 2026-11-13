import React, { useState, useMemo } from "react";
import {
  Calendar,
  CalendarRange,
  Coins,
  Cpu,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useMonitorStore } from "../store/useMonitorStore";
import type { DateFilter } from "../types";

const COLORS = [
  "#6366f1",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#3b82f6",
  "#14b8a6",
  "#eab308",
  "#f43f5e",
  "#a855f7",
  "#64748b",
];

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

export const OverviewView: React.FC = () => {
  const {
    dashboard,
    dateFilter,
    setDateFilter,
    customDateRange,
    setCustomDateRange,
    setTab,
    selectConversation,
  } = useMonitorStore();

  const toIsoDate = (d: Date) => d.toISOString().split("T")[0];
  const todayStr = toIsoDate(new Date());
  const defaultStartStr = toIsoDate(new Date(Date.now() - 7 * 86400 * 1000));

  const [startDate, setStartDate] = useState(
    customDateRange?.startDate || defaultStartStr
  );
  const [endDate, setEndDate] = useState(customDateRange?.endDate || todayStr);
  const [showPicker, setShowPicker] = useState(false);
  const [timelineStackMode, setTimelineStackMode] = useState<"stacked" | "separate">("stacked");
  const [timelineDensity, setTimelineDensity] = useState<"continuous" | "activity">("continuous");

  const currentMonthName = new Intl.DateTimeFormat("es-ES", {
    month: "long",
  }).format(new Date());
  const capitalizedMonth =
    currentMonthName.charAt(0).toUpperCase() + currentMonthName.slice(1);

  const filterButtons: { id: DateFilter; label: string; tooltip?: string }[] = [
    { id: "today", label: "Hoy" },
    { id: "24h", label: "Últimas 24h" },
    { id: "week", label: "Esta Semana" },
    {
      id: "month",
      label: `Mes (${capitalizedMonth})`,
      tooltip: `Desde el 1 de ${currentMonthName} hasta hoy`,
    },
    { id: "all", label: "Histórico Total" },
  ];

  const filteredHistory = useMemo(() => {
    if (!dashboard?.history) return [];
    if (timelineDensity === "activity") {
      return dashboard.history.filter(
        (p) => (p.input_tokens + p.cache_tokens + p.output_tokens) > 0
      );
    }
    return dashboard.history;
  }, [dashboard?.history, timelineDensity]);

  const formatNumber = (num: number): string => {
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + "B";
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
    return num.toLocaleString();
  };

  const formatCurrency = (amount: number): string => {
    return "$" + amount.toFixed(2) + " USD";
  };

  if (!dashboard) {
    return (
      <div className="flex items-center justify-center h-96 text-zinc-500">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
      </div>
    );
  }

  const totalTokens =
    dashboard.total_input_tokens +
    dashboard.total_cache_tokens +
    dashboard.total_output_tokens;

  const amortizedPercent = Math.min(
    100,
    Math.round((dashboard.total_cost_usd / (dashboard.subscription_cost_usd || 20)) * 100)
  );

  return (
    <div className="space-y-6">
      {/* Top Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Resumen General & ROI
          </h2>
          <p className="text-xs text-zinc-400">
            Auditoría de llamadas a modelos y valor de cuota en Google Antigravity & agy CLI
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Preset Buttons */}
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1 gap-1">
            {filterButtons.map((btn) => (
              <button
                key={btn.id}
                onClick={() => {
                  setShowPicker(false);
                  setDateFilter(btn.id);
                }}
                title={btn.tooltip}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  dateFilter === btn.id
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {btn.label}
              </button>
            ))}

            {/* Custom Range Button */}
            <button
              onClick={() => setShowPicker(!showPicker)}
              title="Seleccionar un rango de días específico"
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                dateFilter === "custom"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>
                {dateFilter === "custom" && customDateRange
                  ? `${customDateRange.startDate} a ${customDateRange.endDate}`
                  : "Personalizado"}
              </span>
            </button>
          </div>

          {/* Inline Date Range Picker */}
          {(showPicker || dateFilter === "custom") && (
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-1 text-xs shadow-lg">
              <span className="text-zinc-400 font-medium flex items-center gap-1">
                <CalendarRange className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Rango:</span>
              </span>
              <input
                type="date"
                max={endDate || todayStr}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-0.5 text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 font-mono"
              />
              <span className="text-zinc-500 text-xs">hasta</span>
              <input
                type="date"
                min={startDate}
                max={todayStr}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-0.5 text-zinc-200 text-xs focus:outline-none focus:border-indigo-500 font-mono"
              />
              <button
                onClick={() => {
                  if (startDate && endDate) {
                    setCustomDateRange({ startDate, endDate });
                    setShowPicker(false);
                  }
                }}
                disabled={!startDate || !endDate || startDate > endDate}
                className="px-2.5 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg text-[11px] transition-colors shadow-sm disabled:opacity-50"
              >
                Aplicar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ROI Amortization Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-zinc-900 to-indigo-950/30 p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
                <Sparkles className="w-4 h-4" />
              </span>
              <h3 className="text-sm font-semibold text-indigo-200">
                Termómetro de Retorno de Inversión (Suscripción Antigravity)
              </h3>
            </div>
            <p className="text-xs text-zinc-400 max-w-xl">
              Has generado un valor de API estimado de{" "}
              <strong className="text-white font-medium">
                {formatCurrency(dashboard.total_cost_usd)}
              </strong>{" "}
              frente a un costo mensual de suscripción de{" "}
              <strong className="text-zinc-300 font-medium">
                {formatCurrency(dashboard.subscription_cost_usd)}
              </strong>
              .
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-2xl font-black text-emerald-400 tracking-tight flex items-center justify-end gap-1">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                {dashboard.roi_multiplier.toFixed(1)}x
              </div>
              <p className="text-[11px] text-emerald-500/80 font-medium">
                Amortización acumulada
              </p>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400 transition-all duration-500"
              style={{ width: `${amortizedPercent}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-zinc-300 min-w-12 text-right">
            {amortizedPercent}%
          </span>
        </div>
      </div>

      {/* 4 Main KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Tokens */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Tokens Procesados</span>
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-2xl font-extrabold text-white tracking-tight">
              {formatNumber(totalTokens)}
            </div>
          </div>
          <div className="text-[11px] text-zinc-400 flex items-center justify-between border-t border-zinc-800/60 pt-2">
            <span>In: {formatNumber(dashboard.total_input_tokens)}</span>
            <span className="text-cyan-400 font-medium">
              Cache: {formatNumber(dashboard.total_cache_tokens)}
            </span>
            <span>Out: {formatNumber(dashboard.total_output_tokens)}</span>
          </div>
        </div>

        {/* KPI 2: Cost */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Costo Estimado API</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-2xl font-extrabold text-white tracking-tight">
              {formatCurrency(dashboard.total_cost_usd)}
            </div>
          </div>
          <div className="text-[11px] text-emerald-400 flex items-center justify-between border-t border-zinc-800/60 pt-2 font-medium">
            <span>Ahorro por Caché:</span>
            <span>+{formatCurrency(dashboard.cache_savings_usd)}</span>
          </div>
        </div>

        {/* KPI 3: Cache Hit Rate */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Eficiencia de Caché</span>
            <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-2xl font-extrabold text-cyan-400 tracking-tight">
              {dashboard.cache_hit_rate.toFixed(1)}%
            </div>
          </div>
          <div className="text-[11px] text-zinc-400 flex items-center gap-2 border-t border-zinc-800/60 pt-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>96%+ velocidad de respuesta optimizada</span>
          </div>
        </div>

        {/* KPI 4: Turns & Chats */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Actividad Auditada</span>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <div className="text-2xl font-extrabold text-white tracking-tight">
              {dashboard.total_turns.toLocaleString()} turnos
            </div>
          </div>
          <div className="text-[11px] text-zinc-400 flex items-center justify-between border-t border-zinc-800/60 pt-2">
            <span>{dashboard.total_conversations} conversaciones</span>
            <span className="text-amber-400 font-medium">Zero-Config Pull</span>
          </div>
        </div>
      </div>

      {/* Active Live Session Highlight (if available) */}
      {dashboard.active_session && (
        <div
          onClick={() => {
            selectConversation(dashboard.active_session!.id.toString());
            setTab("audit");
          }}
          className="cursor-pointer group border border-zinc-800 hover:border-indigo-500/50 bg-zinc-900/60 hover:bg-zinc-900 p-4 rounded-2xl transition-all flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Sesión Activa Reciente
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium">
                  {dashboard.active_session.origin}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-medium">
                  {dashboard.active_session.total_turns} turnos
                </span>
              </div>
              <h4 className="font-semibold text-sm text-white group-hover:text-indigo-300 transition-colors">
                {dashboard.active_session.title || "Conversación sin título"}
              </h4>
              <p className="text-xs text-zinc-400 truncate max-w-lg">
                {dashboard.active_session.workspace_path || "Sin ruta de proyecto"}
              </p>
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs font-bold text-cyan-400">
              {formatNumber(dashboard.active_session.max_context_tokens)} ctx máx
            </div>
            <p className="text-[11px] text-zinc-400">Ver en inspector &rarr;</p>
          </div>
        </div>
      )}

      {/* Charts Section: Area & Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stacked / Separate Area Timeline */}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Consumo Temporal de Tokens
              </h3>
              <p className="text-xs text-zinc-400">
                Evolución de Entrada (Input), Lectura de Caché y Salida (Output)
              </p>
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              {/* Stack mode toggle */}
              <div className="flex items-center bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-[11px]">
                <button
                  type="button"
                  onClick={() => setTimelineStackMode("stacked")}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                    timelineStackMode === "stacked"
                      ? "bg-zinc-800 text-white shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Apilado: acumula las tres métricas una sobre otra mostrando el total"
                >
                  Apilado
                </button>
                <button
                  type="button"
                  onClick={() => setTimelineStackMode("separate")}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                    timelineStackMode === "separate"
                      ? "bg-zinc-800 text-white shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Separado: cada métrica parte desde 0 de forma independiente"
                >
                  Separado
                </button>
              </div>

              {/* Density toggle */}
              <div className="flex items-center bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-[11px]">
                <button
                  type="button"
                  onClick={() => setTimelineDensity("continuous")}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                    timelineDensity === "continuous"
                      ? "bg-zinc-800 text-white shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Continuo: incluye periodos inactivos con 0 tokens"
                >
                  Continuo
                </button>
                <button
                  type="button"
                  onClick={() => setTimelineDensity("activity")}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                    timelineDensity === "activity"
                      ? "bg-zinc-800 text-white shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Solo actividad: muestra únicamente puntos donde hubo llamadas"
                >
                  Solo Actividad
                </button>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-2 text-[11px] text-zinc-400 pl-1">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-indigo-500" />
                  Input
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  Caché
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Output
                </span>
              </div>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={filteredHistory}>
                <defs>
                  <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={timelineStackMode === "stacked" ? 0.4 : 0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorCache" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={timelineStackMode === "stacked" ? 0.4 : 0.25} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={timelineStackMode === "stacked" ? 0.4 : 0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                />
                <YAxis
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                  tickFormatter={(val) => formatNumber(val)}
                />
                <Tooltip
                  wrapperStyle={{ opacity: 1, zIndex: 100 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const cache = Number(payload.find((p) => p.dataKey === "cache_tokens")?.value || 0);
                    const input = Number(payload.find((p) => p.dataKey === "input_tokens")?.value || 0);
                    const output = Number(payload.find((p) => p.dataKey === "output_tokens")?.value || 0);
                    const total = cache + input + output;

                    return (
                      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 shadow-2xl text-xs space-y-1.5 opacity-100 min-w-[190px]">
                        <div className="font-semibold text-white border-b border-zinc-800 pb-1 flex justify-between items-center gap-4">
                          <span>{label}</span>
                          {timelineStackMode === "stacked" && (
                            <span className="text-zinc-400 font-mono text-[11px]">
                              Total: {formatNumber(total)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-4 text-cyan-400">
                          <span>Caché Read:</span>
                          <span className="font-mono font-medium">{formatNumber(cache)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-indigo-400">
                          <span>Input:</span>
                          <span className="font-mono font-medium">{formatNumber(input)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-emerald-400">
                          <span>Output:</span>
                          <span className="font-mono font-medium">{formatNumber(output)}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cache_tokens"
                  name="Caché Read"
                  stackId={timelineStackMode === "stacked" ? "1" : undefined}
                  stroke="#06b6d4"
                  fill="url(#colorCache)"
                />
                <Area
                  type="monotone"
                  dataKey="input_tokens"
                  name="Input"
                  stackId={timelineStackMode === "stacked" ? "1" : undefined}
                  stroke="#6366f1"
                  fill="url(#colorInput)"
                />
                <Area
                  type="monotone"
                  dataKey="output_tokens"
                  name="Output"
                  stackId={timelineStackMode === "stacked" ? "1" : undefined}
                  stroke="#10b981"
                  fill="url(#colorOutput)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Model Distribution Donut */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Distribución por Modelo
            </h3>
            <p className="text-xs text-zinc-400">
              Proporción de costo de API equivalente
            </p>
          </div>

          {dashboard.models.length > 0 ? (
            <div className="space-y-4 my-2">
              {/* Clean Donut with Center Stat */}
              <div className="h-44 w-full flex items-center justify-center relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dashboard.models}
                      dataKey="cost_usd"
                      nameKey="model_name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={68}
                      paddingAngle={2}
                    >
                      {dashboard.models.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      wrapperStyle={{ opacity: 1, zIndex: 100 }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          const model = cleanModelName(data.model_name);
                          return (
                            <div className="bg-zinc-900 border border-zinc-700 px-3 py-1.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs text-white opacity-100">
                              <span className="text-zinc-400">Costo :</span>
                              <span className="font-bold text-cyan-400">
                                {formatCurrency(data.cost_usd)}
                              </span>
                              <span className="text-zinc-500 font-medium">·</span>
                              <span className="text-zinc-200 font-semibold">{model}</span>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">
                    Total
                  </span>
                  <span className="text-xs font-bold text-white">
                    {formatCurrency(dashboard.total_cost_usd)}
                  </span>
                </div>
              </div>

              {/* Scrollable Model Breakdown List */}
              <div className="max-h-40 overflow-y-auto pr-1 space-y-1.5 divide-y divide-zinc-800/40">
                {dashboard.models.map((m, idx) => (
                  <div
                    key={m.model_name}
                    className="flex items-center justify-between text-xs pt-1.5 first:pt-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                      />
                      <span
                        className="truncate text-zinc-300 font-medium text-[11px]"
                        title={m.model_name}
                      >
                        {cleanModelName(m.model_name)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-right">
                      <span className="text-zinc-400 font-mono text-[11px]">
                        {formatCurrency(m.cost_usd)}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono font-medium">
                        {m.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-zinc-500">
              Sin datos de modelos
            </div>
          )}

          <div className="text-[11px] text-zinc-500 text-center border-t border-zinc-800/60 pt-2">
            Tarifas configurables en la pestaña Ajustes
          </div>
        </div>
      </div>
    </div>
  );
};
