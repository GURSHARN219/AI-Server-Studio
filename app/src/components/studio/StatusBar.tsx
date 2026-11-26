import React from "react";
import { Activity, Cpu } from "lucide-react";
import { useHardwareInfo } from "@/hooks/useHardwareInfo";

export type StatusBarProps = {
  executionMode: "online" | "offline";
  isNetworkOnline: boolean;
  forceOffline: boolean;
  onToggleExecutionMode: () => void;
  tokenCount: number;
  tokenLimit?: number;
  engineAvailable: boolean;
  engineModel?: string | null;
  selectedModelName?: string | null;
  selectedModelSource: "local" | "api";
  providerName?: string;
};

export const StatusBar: React.FC<StatusBarProps> = ({
  executionMode,
  isNetworkOnline,
  forceOffline,
  onToggleExecutionMode,
  tokenCount,
  tokenLimit = 128_000,
  engineAvailable,
  engineModel,
  selectedModelName,
  selectedModelSource,
  providerName,
}) => {
  const { usage, hardware } = useHardwareInfo(3000, engineAvailable);
  const modelName = selectedModelName || engineModel;
  const modelDetail = modelName
    ? `${selectedModelSource === "api" && providerName ? `${providerName} · ` : ""}${modelName}`
    : "No model selected";
  const gpuUsage = hardware?.gpus[0]?.utilizationPercent;

  return (
    <footer className="h-7 bg-statusbar border-t border-border flex items-center px-4 text-[11px] font-mono text-muted-foreground gap-4 shrink-0 select-none">
      <span className="text-foreground/70 tracking-wide">AI Server Studio v1.4.2</span>
      <button
        type="button"
        onClick={onToggleExecutionMode}
        aria-pressed={executionMode === "online"}
        className={`inline-flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:text-foreground ${executionMode === "online" && isNetworkOnline ? "text-foreground/80" : "text-muted-foreground"}`}
        title={executionMode === "offline" ? "Allow tools and agents to access the internet" : "Block internet access for tools and agents"}
      >
        <span className={executionMode === "online" && isNetworkOnline ? "text-status-online" : "text-muted-foreground"}>Tools {executionMode === "online" && isNetworkOnline ? "Online" : "Offline"}</span>
        {!isNetworkOnline && !forceOffline && <span className="text-[9px] opacity-70">auto</span>}
      </button>
      <span className="inline-flex items-center gap-2" title={`Go engine ${engineAvailable ? "ready" : "offline"}`}>
        <span>Go Engine </span><span className={engineAvailable ? "text-status-online" : "text-destructive"}>{engineAvailable ? "Ready" : "Offline"}</span>
      </span>
      <span className="truncate max-w-[210px]" title={modelDetail}>{modelDetail}</span>
      <div className="flex-1" />
      <div className="flex items-center gap-4 tabular-nums whitespace-nowrap">
        <span>{tokenCount.toLocaleString()} / {Math.round(tokenLimit / 1000)}k tokens</span>
        {usage && <span className="hidden items-center gap-1.5 md:inline-flex"><Cpu className="h-3.5 w-3.5" />CPU {Math.round(usage.cpuPercent)}%</span>}
        {gpuUsage != null && <span className="hidden items-center gap-1.5 lg:inline-flex"><Activity className="h-3.5 w-3.5" />GPU {Math.round(gpuUsage)}%</span>}
      </div>
    </footer>
  );
};

export default StatusBar;
