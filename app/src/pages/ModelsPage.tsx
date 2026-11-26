import { useMemo, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Cpu, Trash2, Play, FolderOpen, RefreshCw, Square, FileInput, Settings, Brain, Wrench, Eye, Code, MessageSquare } from "lucide-react";
import { engineAuthHeaders, assessModel, loadModel, unloadModel, syncModelsDir, engineBase, type ModelAssessment } from "@/lib/localEngine";
import { useToast } from "@/hooks/use-toast";
import { loadProviderModelPrefs, type ModelCapability } from "@/lib/providerModelPrefs";
import { listBackendProviders } from "@/lib/api";
import { getAccountSetting } from "@/stores/accountState";

const PATHS_KEY = "app:settings:paths";

type LocalModel = {
  id: string;
  name: string;
  isLoaded: boolean;
  path?: string;
  size_bytes?: number;
};

type SavedApiModel = {
  key: string;
  providerId: string;
  providerName: string;
  providerType: string;
  modelId: string;
  modelType: ModelCapability;
};

const DISPLAY_FILTERS = ["All", "LLMs", "Image", "STT", "TTS", "Video", "Embedding"] as const;
type DisplayFilter = (typeof DISPLAY_FILTERS)[number];

const SOURCE_FILTERS = ["All", "Local", "API", "Cloud"] as const;
type SourceFilter = (typeof SOURCE_FILTERS)[number];

function isEmbedding(id: string) {
  const l = id.toLowerCase();
  return l.includes("embed") || l.includes("bge") || l.includes("e5-") || l.includes("minilm");
}

function getModelsDir(): string {
  try {
    const parsed = getAccountSetting<{ modelsPath?: string }>(PATHS_KEY, {});
    if (parsed.modelsPath) return parsed.modelsPath;
  } catch { /* ignore */ }
  return "";
}

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function parseModelDetails(id: string, name: string) {
  const parts = id.split(/[/\\]/);
  const isEmbed = isEmbedding(id);

  let publisher = "-";
  let llmName = name;
  if (parts.length >= 3) {
    publisher = parts[0];
    llmName = parts.slice(1).join("/");
  } else if (parts.length === 2) {
    publisher = parts[0];
    llmName = parts[1];
  } else {
    llmName = parts[0];
  }

  // simplify name
  llmName = llmName.replace(/\.(gguf|bin)$/i, '');

  const lowerStr = id.toLowerCase();

  let arch = "-";
  if (lowerStr.includes("qwen") && lowerStr.includes("3")) arch = "qwen3";
  else if (lowerStr.includes("qwen") && lowerStr.includes("2.5")) arch = "qwen2.5";
  else if (lowerStr.includes("qwen2")) arch = "qwen2";
  else if (lowerStr.includes("qwen")) arch = "qwen";
  else if (lowerStr.includes("llama-3.2")) arch = "llama3.2";
  else if (lowerStr.includes("llama-3.1")) arch = "llama3.1";
  else if (lowerStr.includes("llama-3")) arch = "llama3";
  else if (lowerStr.includes("llama")) arch = "llama";
  else if (lowerStr.includes("gemma2")) arch = "gemma2";
  else if (lowerStr.includes("gemma")) arch = "gemma";
  else if (lowerStr.includes("mistral")) arch = "mistral";
  else if (lowerStr.includes("mixtral")) arch = "mixtral";
  else if (lowerStr.includes("deepseek-r1")) arch = "deepseek-r1";
  else if (lowerStr.includes("deepseek-coder")) arch = "deepseek-coder";
  else if (lowerStr.includes("deepseek")) arch = "deepseek";
  else if (lowerStr.includes("phi-3")) arch = "phi3";
  else if (lowerStr.includes("phi")) arch = "phi";
  else arch = isEmbed ? "embed" : "unknown";

  let params = "-";
  const paramsMatch = lowerStr.match(/(\d+(?:\.\d+)?[bm])/i);
  if (paramsMatch) {
    params = paramsMatch[1].toUpperCase();
  }

  let quant = "-";
  const quantMatch = lowerStr.match(/(q[0-8]_[k_]?[a-z0-9_]+|fp16|bf16|iq[0-4]_[a-z]+)/i);
  if (quantMatch) {
    quant = quantMatch[1].toUpperCase();
  }

  const caps: { icon: React.ReactNode; label: string }[] = [];
  if (lowerStr.includes("vision") || lowerStr.includes("vl")) caps.push({ icon: <Eye className="w-3 h-3" />, label: "Vision" });
  if (lowerStr.includes("tool") || lowerStr.includes("function") || lowerStr.includes("coder") || arch.includes("llama3") || arch.includes("qwen")) caps.push({ icon: <Wrench className="w-3 h-3" />, label: "Tools" });
  if (lowerStr.includes("think") || lowerStr.includes("reason") || lowerStr.includes("r1")) caps.push({ icon: <Brain className="w-3 h-3" />, label: "Reasoning" });
  if (lowerStr.includes("code") || lowerStr.includes("coder")) caps.push({ icon: <Code className="w-3 h-3" />, label: "Code" });
  if (lowerStr.includes("chat") || lowerStr.includes("instruct")) caps.push({ icon: <MessageSquare className="w-3 h-3" />, label: "Chat" });

  return { publisher, llmName, arch, params, quant, caps };
}

interface ModelsPageProps {
  onOpenModelConfig?: (
    modelName: string,
    context?: {
      source: "local" | "api";
      providerName?: string;
      providerType?: string;
      modelType?: ModelCapability;
    }
  ) => void;
}

export default function ModelsPage({ onOpenModelConfig }: ModelsPageProps = {}) {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState<LocalModel[]>([]);
  const [available, setAvailable] = useState<LocalModel[]>([]);
  const [savedApiModels, setSavedApiModels] = useState<SavedApiModel[]>([]);
  const [fetching, setFetching] = useState(true);
  const [displayFilter, setDisplayFilter] = useState<DisplayFilter>("All");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("All");
  const [acting, setActing] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<Record<string, ModelAssessment>>({});
  const [assessing, setAssessing] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState("");
  const [showManual, setShowManual] = useState(false);

  const fetchSavedApiModels = useCallback(async () => {
    const prefs = loadProviderModelPrefs();
    const providerMetaMap = new Map<string, { name: string; type: string }>();
    try {
      const data = await listBackendProviders();
      (data || []).forEach((p: { id: string; name: string; provider_type?: string }) => {
        providerMetaMap.set(p.id, {
          name: p.name,
          type: (p.provider_type || "custom").toLowerCase(),
        });
      });
    } catch {
      // ignore provider lookup failures; fallback to provider id
    }

    const rows: SavedApiModel[] = [];
    const dedupe = new Set<string>();

    for (const [providerId, pref] of Object.entries(prefs)) {
      const providerMeta = providerMetaMap.get(providerId);
      const providerName = providerMeta?.name || providerId;
      const providerType = providerMeta?.type || "custom";
      const selections = (pref.selections && pref.selections.length > 0)
        ? pref.selections
        : (pref.allowedModels || []).map((modelId) => ({ modelId, modelType: "chat" as const }));

      selections.forEach((sel) => {
        const modelId = sel.modelId?.trim();
        if (!modelId) return;
        const key = `${providerId}::${modelId}::${sel.modelType}`;
        if (dedupe.has(key)) return;
        dedupe.add(key);
        rows.push({
          key,
          providerId,
          providerName,
          providerType,
          modelId,
          modelType: sel.modelType,
        });
      });
    }

    setSavedApiModels(rows);
  }, []);

  const fetchModels = useCallback(async () => {
    setFetching(true);

    // Push current models dir to engine
    const modelsDir = getModelsDir();
    await syncModelsDir(modelsDir);

    // Currently loaded model(s) — fetch from /v1/models
    let engineModelIds: string[] = [];
    try {
      const r = await fetch(`${engineBase()}/models`, {
        headers: engineAuthHeaders(),
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) {
        const d = await r.json();
        engineModelIds = (d.data ?? []).map((m: { id: string }) => m.id);
      }
    } catch { /* engine offline */ }
    const loadedList: LocalModel[] = engineModelIds.map(id => ({ id, name: id, isLoaded: true }));

    // All available .gguf files on disk
    let availableList: LocalModel[] = [];
    try {
      const res = await fetch(`${engineBase()}/models/available`, {
        headers: engineAuthHeaders(),
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        availableList = (data.data ?? []).map((m: { id: string; path: string; size_bytes?: number }) => ({
          id: m.id,
          name: m.id,
          isLoaded: loadedList.some(l => l.id === m.id),
          path: m.path,
          size_bytes: m.size_bytes,
        }));
      }
    } catch { /* engine offline */ }

    setLoaded(loadedList);
    setAvailable(availableList);
    setFetching(false);
  }, []);

  useEffect(() => {
    void fetchModels();
    void fetchSavedApiModels();
  }, [fetchModels, fetchSavedApiModels]);

  const allModels = useMemo<LocalModel[]>(() => {
    if (available.length > 0) return available;
    return loaded;
  }, [available, loaded]);

  const filtered = useMemo(() =>
    allModels.filter(m => {
      if (displayFilter === "Embedding") return isEmbedding(m.id);
      if (displayFilter === "LLMs") return !isEmbedding(m.id);
      if (displayFilter === "Image" || displayFilter === "STT" || displayFilter === "TTS" || displayFilter === "Video") return false;
      return true;
    }),
    [allModels, displayFilter]);

  const filteredSavedApiModels = useMemo(() => {
    return savedApiModels.filter((m) => {
      if (displayFilter === "All") return true;
      if (displayFilter === "LLMs") return m.modelType === "chat";
      if (displayFilter === "Image") return m.modelType === "image";
      if (displayFilter === "STT") return m.modelType === "stt";
      if (displayFilter === "TTS") return m.modelType === "tts";
      if (displayFilter === "Video") return m.modelType === "video";
      if (displayFilter === "Embedding") return isEmbedding(m.modelId);
      return true;
    });
  }, [savedApiModels, displayFilter]);

  const mergedRows = useMemo(() => {
    const localRows = filtered.map((model) => ({ source: "local" as const, model }));
    const apiRows = filteredSavedApiModels.map((saved) => ({ source: "api" as const, saved }));

    if (sourceFilter === "Local") return localRows;
    if (sourceFilter === "API") return apiRows;
    if (sourceFilter === "Cloud") return [];
    return [...localRows, ...apiRows];
  }, [filtered, filteredSavedApiModels, sourceFilter]);

  const handleLoad = async (model: LocalModel) => {
    if (!model.path) return;
    setActing(model.id);
    const result = await loadModel(model.path);
    if (result.ok) {
      toast({ title: `Loaded ${model.name}` });
    } else {
      toast({ title: "Load failed", description: result.error, variant: "destructive" });
    }
    await fetchModels();
    setActing(null);
  };

  const handleUnload = async (model: LocalModel) => {
    setActing(model.id);
    await unloadModel();
    toast({ title: "Model unloaded" });
    await fetchModels();
    setActing(null);
  };

  const handleManualLoad = async () => {
    const p = manualPath.trim();
    if (!p) return;
    setActing("__manual__");
    const result = await loadModel(p);
    if (result.ok) {
      toast({ title: "Model loaded" });
      setManualPath("");
      setShowManual(false);
    } else {
      toast({ title: "Load failed", description: result.error, variant: "destructive" });
    }
    await fetchModels();
    setActing(null);
  };

  const openFolder = () => {
    const dir = getModelsDir();
    toast({ title: "Models folder", description: dir });
  };

  const handleAssess = async (model: LocalModel) => {
    if (!model.path) return;
    setAssessing(model.id);
    try {
      const assessment = await assessModel(model.path);
      setAssessments((current) => ({ ...current, [model.id]: assessment }));
    } catch (error) {
      toast({ title: "Assessment failed", description: error instanceof Error ? error.message : "Unable to assess model", variant: "destructive" });
    } finally {
      setAssessing(null);
    }
  };

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h1 className="text-base font-semibold text-foreground">My Models</h1>
            <p className="text-[11px] text-muted-foreground">
              {fetching
                ? "Scanning..."
                : `${allModels.length} local · ${loaded.length} loaded · ${savedApiModels.length} saved API`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowManual(v => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary text-secondary-foreground text-[11px] hover:bg-surface-hover transition-colors shrink-0"
            >
              <FileInput className="w-3.5 h-3.5" />
              Load by path
            </button>
            <button
              type="button"
              onClick={fetchModels}
              disabled={fetching}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary text-secondary-foreground text-[11px] hover:bg-surface-hover transition-colors disabled:opacity-50 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${fetching ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={openFolder}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary text-secondary-foreground text-[11px] hover:bg-surface-hover transition-colors shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Open folder
            </button>
          </div>
        </div>

        {/* Manual path input */}
        {showManual && (
          <div className="mb-4 flex gap-2 items-center">
            <input
              type="text"
              value={manualPath}
              onChange={e => setManualPath(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleManualLoad()}
              placeholder="Absolute path to .gguf file..."
              className="flex-1 bg-secondary border border-border rounded-md px-3 py-1.5 text-[11px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={handleManualLoad}
              disabled={!manualPath.trim() || acting === "__manual__"}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
            >
              <Play className="w-3 h-3" />
              {acting === "__manual__" ? "Loading..." : "Load"}
            </button>
          </div>
        )}

        {/* Filters in one line */}
        <div className="mb-4 flex items-center justify-between gap-3 overflow-x-auto scrollbar-thin pb-1">
          <div className="flex items-center gap-1 py-0.5 shrink-0">
            {DISPLAY_FILTERS.map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setDisplayFilter(k)}
                className={`px-2 py-0.5 rounded-full text-[9px] font-medium transition-colors ${displayFilter === k
                    ? "bg-muted text-foreground ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
              >
                {k}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 py-0.5 shrink-0">
            {SOURCE_FILTERS.map((k) => (
              <button
                key={k}
                type="button"
                disabled={k === "Cloud"}
                onClick={() => setSourceFilter(k)}
                className={`px-2 py-0.5 rounded-full text-[9px] font-medium border transition-colors ${sourceFilter === k
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  } ${k === "Cloud" ? "opacity-60 cursor-not-allowed" : ""}`}
                title={k === "Cloud" ? "Coming soon" : undefined}
              >
                {k === "Cloud" ? "Cloud (Coming Soon)" : k}
              </button>
            ))}
          </div>
        </div>

        {/* Unified table header */}
        {!fetching && mergedRows.length > 0 && (
          <div className="hidden md:grid grid-cols-[80px_60px_1.5fr_2fr_90px_80px_80px_110px] gap-6 px-4 py-2 text-[11px] font-semibold text-muted-foreground border-b border-border/50 mb-2 items-center">
            <div>Arch</div>
            <div>Params</div>
            <div>Publisher</div>
            <div>LLM</div>
            <div>Quant</div>
            <div>Size</div>
            <div>Modified</div>
            <div className="text-right pr-2">Actions</div>
          </div>
        )}

        {/* Unified continuous cards */}
        <div className="space-y-0.5">
          {fetching ? (
            <div className="text-xs text-muted-foreground text-center py-10 border border-dashed border-border rounded-lg">
              Scanning models...
            </div>
          ) : mergedRows.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-10 border border-dashed border-border rounded-lg">
              {sourceFilter === "Cloud"
                ? "Cloud models are coming soon."
                : "No models match this filter."}
            </div>
          ) : (
            mergedRows.map((row, i) => {
              if (row.source === "local") {
                const model = row.model;
                const details = parseModelDetails(model.id, model.name);
                return (
                  <motion.div
                    key={model.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className={`group border-b border-border/30 hover:bg-surface-hover/30 transition-colors ${model.isLoaded ? 'bg-primary/5' : ''} px-4 py-3`}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-[80px_60px_1.5fr_2fr_90px_80px_80px_110px] gap-6 items-center">

                      {/* Arch */}
                      <div className="hidden md:flex items-center">
                        <span className="px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground font-mono bg-background">
                          {details.arch}
                        </span>
                      </div>

                      {/* Params */}
                      <div className="hidden md:flex items-center">
                        {details.params !== "-" ? (
                          <span className="px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground font-mono bg-background">
                            {details.params}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">-</span>
                        )}
                      </div>

                      {/* Publisher */}
                      <div className="hidden md:block text-[11px] text-foreground/80 truncate font-medium" title={details.publisher}>
                        {details.publisher}
                      </div>

                      {/* LLM */}
                      <div className="min-w-0 flex items-center gap-1.5">
                        {model.isLoaded && (
                          <span className="w-1.5 h-1.5 rounded-full bg-status-online shrink-0 shadow-[0_0_8px_rgba(34,197,94,0.6)]" title="Loaded" />
                        )}
                       <span className="text-[11px] text-foreground font-semibold truncate hover:text-primary cursor-default transition-colors" title={model.path || details.llmName}>{details.llmName}</span>
                        <div className="hidden md:flex items-center gap-0.5 shrink-0 opacity-60">
                          {details.caps.map((c, idx) => (
                            <span key={idx} title={c.label} className="text-muted-foreground">{c.icon}</span>
                          ))}
                        </div>
                        {assessments[model.id] && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${assessments[model.id].status === "compatible" ? "text-status-online border-status-online/30 bg-status-online/10" : "text-status-downloading border-status-downloading/30 bg-status-downloading/10"}`} title={assessments[model.id].reason}>
                            {assessments[model.id].status.replaceAll("_", " ")}
                          </span>
                        )}
                      </div>

                      {/* Quant */}
                      <div className="hidden md:flex items-center">
                        {details.quant !== "-" ? (
                          <span className="px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground font-mono bg-background">
                            {details.quant}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">-</span>
                        )}
                      </div>

                      {/* Size */}
                      <div className="text-[11px] text-muted-foreground">
                        {formatSize(model.size_bytes)}
                      </div>

                      {/* Modified */}
                      <div className="hidden md:block text-[11px] text-muted-foreground whitespace-nowrap">
                        -
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-1.5 min-w-[max-content]">
                        <button
                          type="button"
                          onClick={() => void handleAssess(model)}
                          disabled={assessing === model.id || !model.path}
                          className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                          title="Assess memory and backend compatibility"
                        >
                          <Cpu className={`w-3.5 h-3.5 ${assessing === model.id ? "animate-pulse" : ""}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenModelConfig?.(model.name, { source: "local" })}
                          className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                          title="Model Settings"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                        {model.isLoaded ? (
                          <button
                            type="button"
                            onClick={() => handleUnload(model)}
                            disabled={acting === model.id}
                            className="flex items-center justify-center w-7 h-7 rounded text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                            title="Unload Model"
                          >
                            <Square className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleLoad(model)}
                            disabled={acting === model.id || !model.path}
                            title={!model.path ? "No path available — use Load by path" : "Load Model"}
                            className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete Model"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              }

              const m = row.saved;
              return (
                <motion.div
                  key={m.key}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.015 }}
                  className="group border-b last:border-b-0 border-border/30 hover:bg-surface-hover/30 transition-colors px-4 py-3"
                >
                  <div className="grid grid-cols-1 md:grid-cols-[80px_60px_1.5fr_2fr_90px_80px_80px_110px] gap-6 items-center">
                    <div className="hidden md:flex items-center">
                      <span className="px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground font-mono bg-background">
                        api
                      </span>
                    </div>
                    <div className="hidden md:flex items-center">
                      <span className="text-[10px] text-muted-foreground">-</span>
                    </div>
                    <div className="hidden md:block text-[11px] text-foreground/80 truncate font-medium" title={m.providerName}>
                      {m.providerName}
                    </div>
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" title="Saved API model" />
                      <span className="text-[11px] text-foreground font-semibold truncate" title={m.modelId}>{m.modelId}</span>
                    </div>
                    <div className="hidden md:flex items-center">
                      <span className="px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground font-mono bg-background uppercase">
                        {m.modelType}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">-</div>
                    <div className="hidden md:block text-[11px] text-muted-foreground whitespace-nowrap">-</div>
                    <div className="flex items-center justify-end gap-1.5 min-w-[max-content]">
                      <button
                        type="button"
                        onClick={() => onOpenModelConfig?.(m.modelId, {
                          source: "api",
                          providerName: m.providerName,
                          providerType: m.providerType,
                          modelType: m.modelType,
                        })}
                        className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                        title="Config options"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
              })
          )}
        </div>
      </div>
    </div>
  );
}
import { engineFetch as fetch } from "@/api/client";
