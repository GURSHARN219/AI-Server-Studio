import { Info, Check, RefreshCw } from "lucide-react";
import type { useHardwareInfo } from "@/hooks/useHardwareInfo";

type HardwareHook = ReturnType<typeof useHardwareInfo>;

export default function HardwareTab({ hw }: { hw: HardwareHook }) {
  const { hardware, usage, loading, error, formatBytes } = hw;

  return (
    <div className="space-y-6">
      {error && (
        <div className="px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">{error}</div>
      )}

      {loading && !hardware && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Reading hardware info...
        </div>
      )}

      {hardware && (
        <>
          <div className="grid grid-cols-2 gap-4">
            {/* CPU */}
            <div className="bg-surface-hover/30 border border-border/50 rounded-xl p-4 space-y-4">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-medium text-foreground">CPU</h3>
                <Info className="w-3 h-3 text-muted-foreground" />
                <span className="ml-auto flex items-center gap-1 text-[11px] text-status-online bg-status-online/10 px-1.5 py-0.5 rounded">
                  <Check className="w-3 h-3" /> Compatible
                </span>
              </div>
              <div className="space-y-3">
                <Row label="Name">
                  <span className="text-xs text-foreground font-medium text-right max-w-[60%] truncate">{hardware.cpu.name}</span>
                </Row>
                <Row label="Cores">
                  <span className="text-xs text-foreground font-medium">{hardware.cpu.physicalCores}P / {hardware.cpu.cores}T</span>
                </Row>
                <Row label="Speed">
                  <span className="text-xs text-foreground font-medium">{hardware.cpu.speed} GHz</span>
                </Row>
                <Row label="Architecture">
                  <div className="flex items-center gap-1 flex-wrap justify-end max-w-[60%]">
                    <Badge>{hardware.arch}</Badge>
                    {(hardware.cpu.extensions ?? []).map(ext => <Badge key={ext}>{ext}</Badge>)}
                  </div>
                </Row>
              </div>
            </div>

            {/* Memory */}
            <div className="bg-surface-hover/30 border border-border/50 rounded-xl p-4 space-y-4">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-medium text-foreground">Memory Capacity</h3>
                <Info className="w-3 h-3 text-muted-foreground" />
              </div>
              <div className="space-y-3">
                <Row label="RAM Total"><span className="text-xs text-foreground font-medium">{formatBytes(hardware.memory.totalRam)}</span></Row>
                <Row label="RAM Free"> <span className="text-xs text-foreground font-medium">{formatBytes(hardware.memory.freeRam)}</span></Row>
                {(hardware.gpus ?? []).length > 0 && (
                  <Row label="VRAM"><span className="text-xs text-foreground font-medium">{formatBytes(hardware.gpus[0].vram)}</span></Row>
                )}
              </div>
            </div>
          </div>

          {/* GPUs */}
          {(hardware.gpus ?? []).length > 0 && (
            <div className="bg-surface-hover/30 border border-border/50 rounded-xl p-4 space-y-4">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-medium text-foreground">GPUs</h3>
                <Info className="w-3 h-3 text-muted-foreground" />
                <p className="ml-2 text-xs text-muted-foreground font-medium">
                  {hardware.gpus.length} GPU{hardware.gpus.length > 1 ? "s" : ""} detected
                  {hardware.gpus.some(g => g.hasCuda) ? " · CUDA" : hardware.gpus.some(g => g.hasVulkan) ? " · Vulkan" : ""}
                </p>
              </div>
              {hardware.gpus.map((gpu, i) => (
                <div key={i} className="bg-surface-active/50 border border-border/50 rounded-lg p-3 space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">{gpu.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        VRAM: {formatBytes(gpu.vram)}
                        {gpu.hasCuda ? " · CUDA" : gpu.hasVulkan ? " · Vulkan" : ""}
                        {" · deviceId: "}{gpu.deviceId}
                        {gpu.driverVersion ? ` · driver ${gpu.driverVersion}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${gpu.hasCuda || gpu.hasVulkan ? "bg-status-online/10 text-status-online" : "bg-muted text-muted-foreground"}`}>
                        {gpu.hasCuda || gpu.hasVulkan ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2 pt-1 border-t border-border/30">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-foreground">Limit Model Offload to Dedicated GPU Memory</span>
                      <span className="text-[10px] text-muted-foreground italic">not configurable</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">OFF: Allow model weights to offload to shared memory if dedicated GPU memory is full</p>
                    <div className="border-t border-border/30 pt-2 flex items-center justify-between">
                      <span className="text-xs text-foreground flex items-center gap-1.5">
                        Offload KV Cache to GPU Memory <Info className="w-3 h-3 text-muted-foreground" />
                      </span>
                      <span className="text-[10px] text-muted-foreground italic">not configurable</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Resource Monitor */}
          <div className="bg-surface-hover/30 border border-border/50 rounded-xl p-4 space-y-4">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-medium text-foreground">Resource Monitor</h3>
              <Info className="w-3 h-3 text-muted-foreground" />
              <span className="ml-auto text-[10px] text-muted-foreground">live · 3s</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface-active/50 border border-border/50 rounded-lg p-3 flex justify-between items-center">
                <span className="text-xs text-muted-foreground">RAM Used</span>
                <span className="text-xs text-foreground font-medium">{usage ? formatBytes(usage.ramUsed) : "—"}</span>
              </div>
              <div className="bg-surface-active/50 border border-border/50 rounded-lg p-3 flex justify-between items-center">
                <span className="text-xs text-muted-foreground">CPU Load</span>
                <span className="text-xs text-foreground font-medium">{usage ? `${usage.cpuPercent.toFixed(1)}%` : "—"}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1.5 py-0.5 rounded bg-surface-active text-[10px] text-muted-foreground border border-border/50">{children}</span>
  );
}
