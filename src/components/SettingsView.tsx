import React, { useState, useEffect } from "react";
import {
  Check,
  Coins,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  FolderSync,
  Lock,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api } from "../services/api";
import { useMonitorStore } from "../store/useMonitorStore";
import type { ModelPrice } from "../types";

interface DecimalInputProps {
  value: number;
  onChange: (value: number) => void;
  onEnter?: () => void;
  className?: string;
}

const DecimalInput: React.FC<DecimalInputProps> = ({
  value,
  onChange,
  onEnter,
  className = "",
}) => {
  const [text, setText] = useState<string>(value.toString());
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(value.toString());
    }
  }, [value, focused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow empty, digits, and a single dot or comma
    if (!/^[0-9]*[.,]?[0-9]*$/.test(raw)) return;
    setText(raw);

    const normalized = raw.replace(",", ".");
    if (normalized === "" || normalized === ".") return;
    const parsed = parseFloat(normalized);
    if (!isNaN(parsed) && parsed >= 0) {
      onChange(parsed);
    }
  };

  const handleBlur = () => {
    setFocused(false);
    const normalized = text.replace(",", ".");
    const parsed = parseFloat(normalized);
    if (isNaN(parsed) || parsed < 0) {
      onChange(0);
      setText("0");
    } else {
      onChange(parsed);
      setText(parsed.toString());
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => setFocused(true)}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) {
          handleBlur();
          onEnter();
        }
      }}
      className={className}
    />
  );
};

const suggestModelRule = (rawModel: string): { pattern: string; displayName: string } => {
  const base = rawModel.replace(/-(low|medium|high|trial|tiered|n|s)$/i, "");
  const parts = base.split("-").filter(Boolean);
  const title = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

  let displayName = title;
  if (base.startsWith("gemini-")) displayName = `Google ${title}`;
  else if (base.startsWith("claude-")) displayName = `Anthropic ${title}`;
  else if (base.startsWith("gpt-")) displayName = `OpenAI ${title}`;

  return {
    pattern: `*${base}*`,
    displayName,
  };
};

export const SettingsView: React.FC = () => {
  const {
    pricing,
    savePricing,
    subscriptionCost,
    setSubscriptionCost,
    triggerRescan,
    syncing,
    loading,
  } = useMonitorStore();

  const [localPricing, setLocalPricing] = useState<ModelPrice[]>([]);
  const [unmatchedModels, setUnmatchedModels] = useState<string[]>([]);
  const [localSubCost, setLocalSubCost] = useState<number>(subscriptionCost);
  const [subCostSaved, setSubCostSaved] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [anonymizeExport, setAnonymizeExport] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadUnmatched = async () => {
    try {
      const models = await api.getUnmatchedModels();
      setUnmatchedModels(models);
    } catch (err) {
      console.error("Failed to fetch unmatched models:", err);
    }
  };

  useEffect(() => {
    loadUnmatched();
  }, []);

  useEffect(() => {
    setLocalSubCost(subscriptionCost);
  }, [subscriptionCost]);

  const handleSaveSubCost = () => {
    setSubscriptionCost(localSubCost);
    setSubCostSaved(true);
    setTimeout(() => setSubCostSaved(false), 2500);
  };

  const handleExport = async (format: "csv" | "json") => {
    try {
      setExporting(true);
      const data = await api.exportData(format, anonymizeExport);
      const blob = new Blob([data], {
        type: format === "json" ? "application/json" : "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `monitortok_export_${anonymizeExport ? "anon_" : ""}${Date.now()}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    setLocalPricing(pricing);
  }, [pricing]);

  const tsToDateStr = (ts?: number | null) => {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    return d.toISOString().split("T")[0];
  };

  const dateStrToTs = (str: string) => {
    if (!str) return null;
    const d = new Date(`${str}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
  };

  const handlePriceChange = (
    index: number,
    field: keyof ModelPrice,
    value: string | number
  ) => {
    const updated = [...localPricing];
    (updated[index] as any)[field] = value;
    setLocalPricing(updated);
  };

  const handleAddSuggestedModel = (rawModel: string) => {
    const { pattern, displayName } = suggestModelRule(rawModel);
    setLocalPricing([
      ...localPricing,
      {
        model_pattern: pattern,
        display_name: displayName,
        input_per_1m: 1.0,
        cache_read_per_1m: 0.1,
        output_per_1m: 4.0,
        valid_from: null,
        valid_to: null,
      },
    ]);
  };

  const handleAddRule = () => {
    setLocalPricing([
      ...localPricing,
      {
        model_pattern: "*nuevo*",
        display_name: "Nuevo Modelo",
        input_per_1m: 1.0,
        cache_read_per_1m: 0.25,
        output_per_1m: 4.0,
        valid_from: null,
        valid_to: null,
      },
    ]);
  };

  const handleDeleteRule = (index: number) => {
    setLocalPricing(localPricing.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSubscriptionCost(localSubCost);
    await savePricing(localPricing);
    await loadUnmatched();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">
          Tarifas & Configuración
        </h2>
        <p className="text-xs text-zinc-400">
          Personaliza los precios de referencia por 1M de tokens y el ciclo de facturación
        </p>
      </div>

      {/* Subscription Cost Card */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-white font-semibold text-sm">
          <CreditCard className="w-4 h-4 text-indigo-400" />
          <span>Suscripción Mensual de Antigravity</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-xs text-zinc-400 max-w-md">
            Monto de referencia que pagas mensualmente por Antigravity para calcular el termómetro de retorno de inversión (ROI) y amortización.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 font-mono">$</span>
              <DecimalInput
                value={localSubCost}
                onChange={setLocalSubCost}
                onEnter={handleSaveSubCost}
                className="w-24 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
              />
              <span className="text-xs text-zinc-400">USD / mes</span>
            </div>
            <button
              onClick={handleSaveSubCost}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl transition-all cursor-pointer ${
                subCostSaved
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 active:scale-95"
              }`}
              title="Guardar monto de suscripción"
            >
              {subCostSaved ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardado</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Monitored Roots Card */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <FolderSync className="w-4 h-4 text-cyan-400" />
            <span>Directorios Vigilados en Linux</span>
          </div>
          <button
            onClick={triggerRescan}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white rounded-xl transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            <span>Re-escanear Historial</span>
          </button>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
            <div>
              <span className="font-semibold text-white block">
                Antigravity IDE / Desktop App
              </span>
              <span className="text-zinc-500 font-mono text-[11px]">
                ~/.gemini/antigravity/conversations
              </span>
            </div>
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5" />
              Conectado (mode=ro)
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
            <div>
              <span className="font-semibold text-white block">
                Antigravity Terminal CLI (agy)
              </span>
              <span className="text-zinc-500 font-mono text-[11px]">
                ~/.gemini/antigravity-cli/conversations
              </span>
            </div>
            <span className="flex items-center gap-1.5 text-cyan-400 font-medium text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5" />
              Conectado (mode=ro)
            </span>
          </div>
        </div>
      </div>

      {/* Model Pricing Table Card */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Coins className="w-4 h-4 text-amber-400" />
            <span>Tarifario de Referencia por 1M de Tokens (USD)</span>
          </div>
          <button
            onClick={handleAddRule}
            className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-indigo-400 rounded-xl transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Añadir Regla</span>
          </button>
        </div>

        <p className="text-xs text-zinc-400">
          Al guardar los cambios, el motor recalculará inmediatamente el valor de todos los turnos históricos almacenados en tu base de datos local.
        </p>

        {unmatchedModels.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2">
            <div className="text-xs font-medium text-amber-300">
              Modelos detectados en tu historial sin tarifa específica (usando tarifa estándar):
            </div>
            <div className="flex flex-wrap gap-2">
              {unmatchedModels.map((model) => (
                <button
                  key={model}
                  onClick={() => handleAddSuggestedModel(model)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-amber-500/30 text-[11px] font-mono text-amber-200 transition-colors cursor-pointer"
                  title={`Añadir regla sugerida para ${model}`}
                >
                  <Plus className="w-3 h-3 text-amber-400" />
                  <span>{model}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-x-auto border border-zinc-800 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950/60 border-b border-zinc-800 text-zinc-400 font-semibold text-[11px]">
              <tr>
                <th className="px-3 py-2.5 text-left min-w-[140px]">Patrón</th>
                <th className="px-3 py-2.5 text-left min-w-[200px]">Modelo Oficial (Nombre Completo)</th>
                <th className="px-3 py-2.5 text-center w-24">Input ($/1M)</th>
                <th className="px-3 py-2.5 text-center w-24">Caché ($/1M)</th>
                <th className="px-3 py-2.5 text-center w-24">Output ($/1M)</th>
                <th className="px-3 py-2.5 text-center w-56">Vigencia (Desde → Hasta)</th>
                <th className="px-3 py-2.5 text-center w-14">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {localPricing.map((item, idx) => (
                <tr key={idx} className="hover:bg-zinc-800/30">
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={item.model_pattern}
                      onChange={(e) =>
                        handlePriceChange(idx, "model_pattern", e.target.value)
                      }
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={item.display_name}
                      onChange={(e) =>
                        handlePriceChange(idx, "display_name", e.target.value)
                      }
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-zinc-200 font-sans"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <DecimalInput
                      value={item.input_per_1m}
                      onChange={(val) =>
                        handlePriceChange(idx, "input_per_1m", val)
                      }
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-center text-zinc-200 focus:outline-none focus:border-indigo-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <DecimalInput
                      value={item.cache_read_per_1m}
                      onChange={(val) =>
                        handlePriceChange(idx, "cache_read_per_1m", val)
                      }
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-center text-cyan-400 focus:outline-none focus:border-indigo-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <DecimalInput
                      value={item.output_per_1m}
                      onChange={(val) =>
                        handlePriceChange(idx, "output_per_1m", val)
                      }
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-center text-emerald-400 focus:outline-none focus:border-indigo-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1 font-sans">
                      <input
                        type="date"
                        value={tsToDateStr(item.valid_from)}
                        onChange={(e) => {
                          const updated = [...localPricing];
                          updated[idx].valid_from = dateStrToTs(e.target.value);
                          setLocalPricing(updated);
                        }}
                        title="Válido desde (en blanco para siempre)"
                        className="w-24 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-indigo-500"
                      />
                      <span className="text-zinc-500 text-[10px]">→</span>
                      <input
                        type="date"
                        value={tsToDateStr(item.valid_to)}
                        onChange={(e) => {
                          const updated = [...localPricing];
                          updated[idx].valid_to = dateStrToTs(e.target.value);
                          setLocalPricing(updated);
                        }}
                        title="Válido hasta (en blanco para siempre)"
                        className="w-24 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center font-sans">
                    <div className="flex justify-center">
                      <button
                        onClick={() => handleDeleteRule(idx)}
                        className="p-1 hover:text-red-400 text-zinc-500 transition-colors"
                        title="Eliminar regla"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Save Bar */}
        <div className="flex items-center justify-between pt-3">
          {savedSuccess ? (
            <span className="text-xs text-emerald-400 font-medium">
              ✓ Tarifas guardadas y costos recalculados.
            </span>
          ) : (
            <span className="text-xs text-zinc-500">
              Cambios no persistidos hasta hacer clic en Guardar.
            </span>
          )}

          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white rounded-xl shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{loading ? "Recalculando..." : "Guardar Tarifas"}</span>
          </button>
        </div>
      </div>

      {/* Export & Privacy Card */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-white font-semibold text-sm">
          <Download className="w-4 h-4 text-emerald-400" />
          <span>Exportación de Datos & Privacidad</span>
        </div>

        <p className="text-xs text-zinc-400">
          Descarga el historial completo consolidado de turnos, modelos y costos en formato CSV o JSON para análisis externo en hojas de cálculo o herramientas BI.
        </p>

        <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
          <input
            type="checkbox"
            id="anon-check"
            checked={anonymizeExport}
            onChange={(e) => setAnonymizeExport(e.target.checked)}
            className="rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500 bg-zinc-900"
          />
          <label htmlFor="anon-check" className="cursor-pointer flex items-center gap-1.5 select-none">
            <Lock className="w-3.5 h-3.5 text-indigo-400" />
            <span>Anonimizar títulos y rutas de proyectos (Protege nombres privados de repositorios y clientes)</span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => handleExport("csv")}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white rounded-xl transition-colors disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>{exporting ? "Generando..." : "Exportar CSV"}</span>
          </button>

          <button
            onClick={() => handleExport("json")}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white rounded-xl transition-colors disabled:opacity-50"
          >
            <FileText className="w-4 h-4 text-cyan-400" />
            <span>{exporting ? "Generando..." : "Exportar JSON"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
