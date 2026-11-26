import { useState } from "react";
import { X, RotateCcw, ChevronRight, Cpu, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { engineAuthHeaders, engineBase } from "@/lib/localEngine";
import type { ModelCapability } from "@/lib/providerModelPrefs";

interface ModelConfigPanelProps {
  modelName: string;
  modelPath?: string | null;
  configSource?: "local" | "api";
  providerName?: string;
  providerType?: string;
  modelType?: ModelCapability;
  onClose: () => void;
}

function getApiSupportedOptions(providerType?: string, modelType: ModelCapability = "chat") {
  const p = (providerType || "custom").toLowerCase();
  const providerByType: Record<string, Partial<Record<ModelCapability, string[]>>> = {
    openrouter: {
      chat: ["System Prompt", "Temperature", "Max Tokens", "Top P", "Provider Routing", "Fallbacks"],
      image: ["Image Size", "Quality", "Style", "Seed", "Provider Routing"],
    },
    openai: {
      chat: ["System Prompt", "Temperature", "Max Tokens", "Top P", "Reasoning Effort", "Response Format", "Tool Use"],
      image: ["Image Size", "Quality", "Style", "Seed"],
      stt: ["Language", "Timestamp"],
      tts: ["Voice", "Speed", "Format"],
    },
    anthropic: {
      chat: ["Temperature", "Max Tokens", "Top P", "System Prompt", "Tool Use"],
    },
    google: {
      chat: ["System Prompt", "Temperature", "Max Tokens", "Top P", "Safety", "Grounding", "Multimodal"],
      image: ["Image Size", "Safety", "Seed"],
      stt: ["Language", "Timestamp"],
      tts: ["Voice", "Speed", "Format"],
    },
    groq: {
      chat: ["System Prompt", "Temperature", "Max Tokens", "Top P", "Tool Use"],
    },
    mistral: {
      chat: ["System Prompt", "Temperature", "Max Tokens", "Top P", "Tool Use"],
    },
    azure: {
      chat: ["System Prompt", "Temperature", "Max Tokens", "Top P", "Response Format", "Tool Use"],
      image: ["Image Size", "Quality", "Style", "Seed"],
      stt: ["Language", "Timestamp"],
      tts: ["Voice", "Speed", "Format"],
    },
  };

  const genericByType: Partial<Record<ModelCapability, string[]>> = {
    chat: ["System Prompt", "Temperature", "Max Tokens", "Top P"],
    image: ["Image Size", "Quality", "Style", "Seed"],
    stt: ["Language", "Timestamp"],
    tts: ["Voice", "Speed", "Format"],
    video: ["Resolution", "Duration", "FPS", "Seed"],
  };

  return providerByType[p]?.[modelType] || genericByType[modelType] || [];
}

// ── Reusable field components (defined outside to avoid remount on every render) ──

function SliderField({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number;
}) {
  const [inputVal, setInputVal] = useState(String(value));

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n)) {
      const clamped = Math.min(max, Math.max(min, n));
      onChange(parseFloat(clamped.toFixed(10)));
      setInputVal(String(clamped));
    } else {
      setInputVal(String(value));
    }
  };

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = parseFloat(e.target.value);
    onChange(n);
    setInputVal(String(n));
  };

  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
          className="w-14 bg-muted/80 border border-border rounded px-1.5 py-0.5 text-[10px] text-foreground font-mono text-right focus:outline-none focus:ring-1 focus:ring-border tabular-nums"
        />
      </div>
      <div className="relative h-1 group">
        <div className="absolute inset-0 bg-muted rounded-full" />
        <div
          className="absolute inset-y-0 left-0 bg-foreground/25 rounded-full"
          style={{ width: `${percentage}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSlider}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-foreground/70 border border-border shadow-sm pointer-events-none"
          style={{ left: `calc(${percentage}% - 5px)` }}
        />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-[5.5rem] bg-secondary border border-border rounded-md px-2 py-1 text-[10px] text-foreground font-mono text-right focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
      />
    </div>
  );
}

function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="flex items-center gap-1.5 w-full group/section py-0.5">
      <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform shrink-0 ${open ? "rotate-90" : ""}`} />
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold group-hover/section:text-foreground transition-colors">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/80 min-w-[1rem]" />
    </button>
  );
}

// ── Main panel ──

export default function ModelConfigPanel({ modelName, modelPath, configSource = "local", providerName, providerType, modelType = "chat", onClose }: ModelConfigPanelProps) {
  const { toast } = useToast();
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [contextLength, setContextLength] = useState(4096);
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful AI assistant.");
  const [repeatPenalty, setRepeatPenalty] = useState(1.1);
  const [topK, setTopK] = useState(40);
  const [seed, setSeed] = useState(-1);
  const [samplingOpen, setSamplingOpen] = useState(true);
  const [generationOpen, setGenerationOpen] = useState(true);
  const [nCtx, setNCtx] = useState(4096);
  const [nGpuLayers, setNGpuLayers] = useState(999);
  const [nParallel, setNParallel] = useState(1);
  const [engineOpen, setEngineOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [providerRouting, setProviderRouting] = useState("auto");
  const [fallbacks, setFallbacks] = useState("provider_default");
  const isApiMode = configSource === "api";
  const apiOptions = getApiSupportedOptions(providerType, modelType);
  const hasOption = (name: string) => apiOptions.includes(name);

  const resetDefaults = () => {
    setTemperature(0.7); setTopP(0.9); setMaxTokens(2048);
    setContextLength(4096); setRepeatPenalty(1.1); setTopK(40); setSeed(-1);
    setSystemPrompt("You are a helpful AI assistant.");
    setNCtx(4096); setNGpuLayers(999); setNParallel(1);
    setProviderRouting("auto"); setFallbacks("provider_default");
  };

  const handleReload = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${engineBase()}/models/load`, {
        method: "POST",
        headers: engineAuthHeaders(true),
        body: JSON.stringify({
          model_path: modelPath || modelName,
          config: { n_ctx: nCtx, n_gpu_layers: nGpuLayers, n_parallel: nParallel },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(message || "Load failed");
      }
      toast({ title: "Model reloaded", description: `${data.model} loaded with new config` });
    } catch (e) {
      toast({ title: "Reload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full w-full bg-background shrink-0 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/80 shrink-0 bg-muted/20">
        <div className="min-w-0 pr-2">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Model config</p>
          <p className="text-[11px] text-foreground font-medium truncate mt-0.5 font-mono">{modelName}</p>
          {isApiMode && (
            <p className="text-[9px] text-muted-foreground mt-0.5 uppercase tracking-wide">
              {(providerName || "API provider")} • {modelType}
            </p>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" onClick={resetDefaults} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-all" title="Reset defaults">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-all" aria-label="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 space-y-4">
        {isApiMode ? (
          <>
            {hasOption("System Prompt") && (
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground font-medium">System prompt</span>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={3}
                  className="w-full bg-secondary/80 border border-border rounded-md px-2.5 py-2 text-[10px] text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-border leading-relaxed"
                />
              </div>
            )}

            {hasOption("Temperature") && (
              <SliderField label="Temperature" value={temperature} onChange={setTemperature} min={0} max={2} step={0.01} />
            )}
            {hasOption("Top P") && (
              <SliderField label="Top P" value={topP} onChange={setTopP} min={0} max={1} step={0.01} />
            )}
            {hasOption("Max Tokens") && (
              <NumberField label="Max tokens" value={maxTokens} onChange={setMaxTokens} />
            )}

            {hasOption("Provider Routing") && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted-foreground font-medium">Provider routing</span>
                <select
                  value={providerRouting}
                  onChange={(e) => setProviderRouting(e.target.value)}
                  className="w-full bg-secondary/80 border border-border rounded-md px-2 py-1.5 text-[10px] text-foreground focus:outline-none"
                >
                  <option value="auto">auto</option>
                  <option value="latency">latency</option>
                  <option value="cost">cost</option>
                  <option value="quality">quality</option>
                </select>
              </div>
            )}

            {hasOption("Fallbacks") && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted-foreground font-medium">Fallback policy</span>
                <select
                  value={fallbacks}
                  onChange={(e) => setFallbacks(e.target.value)}
                  className="w-full bg-secondary/80 border border-border rounded-md px-2 py-1.5 text-[10px] text-foreground focus:outline-none"
                >
                  <option value="provider_default">provider_default</option>
                  <option value="downgrade">downgrade</option>
                  <option value="off">off</option>
                </select>
              </div>
            )}

            {apiOptions.length > 0 ? (
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted-foreground font-medium">Supported functions</span>
                <div className="flex flex-wrap gap-1.5">
                  {apiOptions.map((opt) => (
                    <span key={opt} className="px-2 py-0.5 rounded border border-border text-[10px] text-muted-foreground bg-background">
                      {opt}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">No supported options found for this provider and model type.</div>
            )}
          </>
        ) : (
          <>
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground font-medium">System prompt</span>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
                className="w-full bg-secondary/80 border border-border rounded-md px-2.5 py-2 text-[10px] text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-border leading-relaxed"
              />
            </div>

            <div className="space-y-2">
              <SectionHeader label="Sampling" open={samplingOpen} onToggle={() => setSamplingOpen(!samplingOpen)} />
              <AnimatePresence>
                {samplingOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="space-y-3 overflow-hidden pt-0.5">
                    <SliderField label="Temperature" value={temperature} onChange={setTemperature} min={0} max={2} step={0.01} />
                    <SliderField label="Top P" value={topP} onChange={setTopP} min={0} max={1} step={0.01} />
                    <NumberField label="Top K" value={topK} onChange={setTopK} />
                    <SliderField label="Repeat penalty" value={repeatPenalty} onChange={setRepeatPenalty} min={1} max={2} step={0.01} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-2">
              <SectionHeader label="Generation" open={generationOpen} onToggle={() => setGenerationOpen(!generationOpen)} />
              <AnimatePresence>
                {generationOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="space-y-2 overflow-hidden pt-0.5">
                    <NumberField label="Max tokens" value={maxTokens} onChange={setMaxTokens} />
                    <NumberField label="Context length" value={contextLength} onChange={setContextLength} />
                    <NumberField label="Seed" value={seed} onChange={setSeed} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-2">
              <SectionHeader label="Engine (llama.cpp)" open={engineOpen} onToggle={() => setEngineOpen(!engineOpen)} />
              <AnimatePresence>
                {engineOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="space-y-2 overflow-hidden pt-0.5">
                    <NumberField label="Context size (n_ctx)" value={nCtx} onChange={setNCtx} />
                    <NumberField label="GPU layers (999 = all)" value={nGpuLayers} onChange={setNGpuLayers} />
                    <NumberField label="Parallel slots (n_parallel)" value={nParallel} onChange={setNParallel} />
                    <button
                      type="button"
                      onClick={handleReload}
                      disabled={isLoading}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors disabled:opacity-50 border border-primary/20"
                    >
                      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cpu className="w-3 h-3" />}
                      {isLoading ? "Reloading..." : "Reload with engine config"}
                    </button>
                    <p className="text-[9px] text-muted-foreground text-center">Reloads the model with new engine parameters</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
import { engineFetch as fetch } from "@/api/client";
