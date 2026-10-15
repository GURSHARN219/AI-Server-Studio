import { useState, useEffect, useCallback } from "react";
import { Activity, Check, Info, Loader2, Search, RefreshCw, Download, HardDrive } from "lucide-react";
import { ToggleField } from "./Primitives";
import { engineAuthHeaders, getEnginePort } from "@/lib/localEngine";
import { useSettingsStore } from "@/stores/settingsStore";

interface BackendEntry {
  name: string;
  displayName: string;
  description: string;
  version: string;
  gpu: string | null;
  gpuMake: string | null;
  cpu: string[];
  active: boolean;
  gpuBackend?: string;
  variant?: string;
  binaryPath?: string;
}

interface EngineInstallStatus {
  installed: boolean;
  installing: boolean;
  variant: string;
  version: string;
  binaryPath: string;
  recommendedVariant: string;
}

export default function RuntimeTab() {
  const [autoUpdate, setAutoUpdate] = useState(true);
  const { advanced, setAdvanced } = useSettingsStore();
  const [backends, setBackends] = useState<BackendEntry[]>([]);
  const [activeBackend, setActiveBackend] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Engine installer state
  const [engineStatus, setEngineStatus] = useState<EngineInstallStatus | null>(null);
  const [installProgress, setInstallProgress] = useState<{ stage: string; message: string; percent: number } | null>(null);
  const [selectedVariant, setSelectedVariant] = useState("auto");

  // Go engine runtime status
  const [goEngineInfo, setGoEngineInfo] = useState<{
    gpuBackend: string;
    gpuLayers: number;
    loaded: boolean;
    modelName: string;
    binaryVariant: string;
    binaryVersion: string;
    cpuOnly: boolean;
  } | null>(null);

  const fetchBackends = useCallback(async () => {
    setLoading(true);
    const engineBase = `http://localhost:${getEnginePort()}/v1`;
    try {
      const [statusRes, backendsRes, engineRes] = await Promise.all([
        fetch(`${engineBase}/system/status`, { headers: engineAuthHeaders(), signal: AbortSignal.timeout(2000) }).catch(() => null),
        fetch(`${engineBase}/system/backends`, { headers: engineAuthHeaders(), signal: AbortSignal.timeout(2000) }).catch(() => null),
        fetch(`${engineBase}/components/engine`, { headers: engineAuthHeaders(), signal: AbortSignal.timeout(2000) }).catch(() => null),
      ]);

      if (statusRes?.ok) {
        const data = await statusRes.json();
        if (data.backend) setActiveBackend(data.backend);
        setGoEngineInfo({
          gpuBackend: data.gpuBackend ?? "none",
          gpuLayers: data.gpuLayers ?? 0,
          loaded: data.loaded ?? false,
          modelName: data.modelName ?? "",
          binaryVariant: data.binaryVariant ?? "",
          binaryVersion: data.binaryVersion ?? "",
          cpuOnly: data.cpuOnly ?? (data.gpuBackend === "none" || data.gpuBackend === ""),
        });
      }

      if (backendsRes?.ok) {
        const data = await backendsRes.json();
        setBackends(data.data ?? []);
      }

      if (engineRes?.ok) {
        const data = await engineRes.json();
        setEngineStatus(data);
        if (data.recommendedVariant) setSelectedVariant(data.recommendedVariant);
      }
    } catch { /* engine offline */ }
    setLoading(false);
  }, []);

  const startInstall = useCallback(async () => {
    const engineBase = `http://localhost:${getEnginePort()}/v1`;
    setInstallProgress({ stage: "starting", message: "Starting installation...", percent: 0 });

    // POST /v1/components/engine/install streams SSE progress directly in the response body
    try {
      const res = await fetch(`${engineBase}/components/engine/install`, {
        method: "POST",
        headers: engineAuthHeaders(true),
        body: JSON.stringify({ variant: selectedVariant }),
      });

      if (!res.ok || !res.body) {
        setInstallProgress({ stage: "error", message: "Failed to start installation", percent: 0 });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const prog = JSON.parse(trimmed.slice(6));
            setInstallProgress(prog);
            if (prog.stage === "done" || prog.stage === "error") {
              fetchBackends();
              return;
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setInstallProgress({ stage: "error", message: (e as Error).message, percent: 0 });
    }
  }, [selectedVariant, fetchBackends]);

  useEffect(() => { fetchBackends(); }, [fetchBackends]);

  const filtered = backends.filter(b =>
    !search || b.displayName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Runtime selection */}
      <div className="space-y-4 bg-surface-hover/30 border border-border/50 rounded-xl p-4">
        <h3 className="text-sm font-medium text-foreground">Runtime Selections</h3>
        <div className="flex items-center justify-between">
          <span className="text-xs text-foreground">GGUF</span>
          <span className="text-xs text-muted-foreground font-mono bg-surface-active px-2 py-1 rounded border border-border/50">
            {activeBackend ?? (loading ? "Detecting…" : "Engine offline")}
          </span>
        </div>
        {goEngineInfo && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground">Go Engine</span>
              <div className="flex items-center gap-1.5">
                {goEngineInfo.cpuOnly ? (
                  <span className="text-[10px] text-muted-foreground bg-surface-active px-1.5 py-0.5 rounded-md border border-border/50">
                    CPU only
                  </span>
                ) : (
                  <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-md border border-primary/20 uppercase">
                    {goEngineInfo.gpuBackend}
                  </span>
                )}
                {goEngineInfo.binaryVariant && (
                  <span className="text-xs text-muted-foreground font-mono bg-surface-active px-2 py-1 rounded border border-border/50">
                    {goEngineInfo.binaryVariant}{goEngineInfo.binaryVersion ? ` ${goEngineInfo.binaryVersion}` : ""}
                  </span>
                )}
                {!goEngineInfo.cpuOnly && goEngineInfo.gpuLayers > 0 && (
                  <span className="text-[10px] text-muted-foreground">{goEngineInfo.gpuLayers} GPU layers</span>
                )}
              </div>
            </div>
          </>
        )}
        <div className="border-t border-border/50" />
        <ToggleField label="Auto-update selected Runtime Extension Packs" value={autoUpdate} onChange={setAutoUpdate} />
      </div>

      {/* Updates channel */}
      <div className="flex items-center justify-between bg-surface-hover/30 border border-border/50 rounded-xl p-4">
        <span className="text-xs flex items-center gap-1.5 text-foreground">
          Runtime updates channel <Info className="w-3.5 h-3.5 text-muted-foreground" />
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchBackends}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-hover hover:bg-surface-active text-xs text-foreground transition-colors border border-border/50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Check for updates
          </button>
          <select
            value={advanced.runtimeUpdateChannel ?? "stable"}
            onChange={e => setAdvanced("runtimeUpdateChannel", e.target.value as "stable" | "beta")}
            className="bg-surface-hover border border-border/50 rounded px-3 py-1.5 text-xs text-foreground focus:outline-none appearance-none cursor-pointer"
          >
            <option value="stable">Stable</option>
            <option value="beta">Beta</option>
          </select>
        </div>
      </div>

      {/* llama-server binary install */}
      <div className="space-y-3 bg-surface-hover/30 border border-border/50 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-muted-foreground" />
            llama-server Binary
          </h3>
          {engineStatus?.installed && (
            <span className="flex items-center gap-1 text-[11px] text-status-online">
              <Check className="w-3.5 h-3.5" />
              {engineStatus.variant} {engineStatus.version}
            </span>
          )}
        </div>

        {engineStatus && !engineStatus.installed && !engineStatus.installing && (
          <p className="text-[11px] text-yellow-500">
            llama-server not found. Install it to run local models.
          </p>
        )}

        {engineStatus?.binaryPath && (
          <p className="text-[11px] text-muted-foreground font-mono truncate">{engineStatus.binaryPath}</p>
        )}

        {/* Progress bar */}
        {installProgress && installProgress.stage !== "done" && installProgress.stage !== "error" && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{installProgress.message}</span>
              <span>{Math.round(installProgress.percent)}%</span>
            </div>
            <div className="h-1.5 bg-surface-active rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${installProgress.percent}%` }}
              />
            </div>
          </div>
        )}

        {installProgress?.stage === "error" && (
          <p className="text-[11px] text-red-400">{installProgress.message}</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <select
            value={selectedVariant}
            onChange={e => setSelectedVariant(e.target.value)}
            className="bg-surface-hover border border-border/50 rounded px-2 py-1.5 text-xs text-foreground focus:outline-none appearance-none cursor-pointer"
          >
            <option value="auto">Auto-detect{engineStatus?.recommendedVariant ? ` (${engineStatus.recommendedVariant})` : ""}</option>
            <option value="cuda13">CUDA 13.x (NVIDIA latest)</option>
            <option value="cuda12">CUDA 12.x (NVIDIA)</option>
            <option value="vulkan">Vulkan (AMD/Intel)</option>
            <option value="hip">HIP/ROCm (AMD)</option>
            <option value="avx2">CPU only (x64)</option>
          </select>
          <button
            onClick={startInstall}
            disabled={engineStatus?.installing || (installProgress != null && installProgress.stage !== "done" && installProgress.stage !== "error")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/10 hover:bg-primary/20 text-xs text-primary transition-colors border border-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {engineStatus?.installing ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Installing...</>
            ) : (
              <><Download className="w-3.5 h-3.5" />{engineStatus?.installed ? "Reinstall" : "Install"}</>
            )}
          </button>
        </div>
      </div>

      {/* Engines list */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Engines & Frameworks</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full bg-surface-hover/50 border border-border/50 rounded-lg pl-9 pr-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="text-xs text-muted-foreground py-4 text-center">Loading backends…</div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">
              {backends.length === 0 ? "Engine offline — start the engine to see backends" : "No backends match search"}
            </div>
          ) : filtered.map(b => (
            <div key={`${b.name}-${b.version}`} className={`flex items-center justify-between p-3 rounded-xl hover:bg-surface-hover/30 transition-colors ${b.active ? "bg-surface-hover/10" : ""}`}>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-foreground">{b.displayName}</span>
                  <span className="text-[10px] text-muted-foreground bg-surface-active px-1.5 py-0.5 rounded-md border border-border/50">v{b.version}</span>
                  {b.gpu && (
                    <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-md border border-primary/20">{b.gpu}</span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{b.description}</p>
              </div>
              {b.active
                ? <span className="flex items-center gap-1 text-[11px] text-status-online shrink-0"><Check className="w-3.5 h-3.5" /> Active</span>
                : <span className="text-[11px] text-muted-foreground shrink-0">Available</span>
              }
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
import { engineFetch as fetch } from "@/api/client";
