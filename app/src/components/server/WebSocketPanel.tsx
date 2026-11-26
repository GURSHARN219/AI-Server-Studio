import { Wifi, WifiOff, Activity, Server, Zap, Clock } from "lucide-react";
import { type ConnectionStatus, formatUptime } from "./types";

type Props = {
  wsStatus: ConnectionStatus;
  serverPort: string;
  uptime: number;
  wsMsgCount: number;
  latency: number;
};

export function WebSocketPanel({ wsStatus, serverPort, uptime, wsMsgCount, latency }: Props) {
  const statusColor = () => {
    switch (wsStatus) {
      case "connected":    return "bg-status-online";
      case "connecting":   return "bg-status-downloading animate-pulse";
      case "disconnected": return "bg-destructive";
    }
  };

  const statusLabel = () => {
    switch (wsStatus) {
      case "connected":    return "Connected";
      case "connecting":   return "Polling...";
      case "disconnected": return "Disconnected";
    }
  };

  const statusTextColor = () => {
    switch (wsStatus) {
      case "connected":    return "text-status-online";
      case "connecting":   return "text-status-downloading";
      case "disconnected": return "text-destructive";
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between bg-secondary/20 border-b border-border/50">
        <div className="flex items-center gap-2">
          {wsStatus === "connected" ? (
            <div className="w-5 h-5 rounded-md bg-status-online/10 flex items-center justify-center">
              <Wifi className="w-3 h-3 text-status-online" />
            </div>
          ) : wsStatus === "connecting" ? (
            <div className="w-5 h-5 rounded-md bg-status-downloading/10 flex items-center justify-center">
              <Activity className="w-3 h-3 text-status-downloading animate-pulse" />
            </div>
          ) : (
            <div className="w-5 h-5 rounded-md bg-destructive/10 flex items-center justify-center">
              <WifiOff className="w-3 h-3 text-destructive" />
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold text-foreground leading-tight">Engine Connection</span>
            <span className="text-[9px] text-muted-foreground font-mono leading-tight">http://127.0.0.1:{serverPort}/v1/status</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${statusColor()}`} />
          <span className={`text-[10px] font-medium ${statusTextColor()}`}>{statusLabel()}</span>
        </div>
      </div>
      <div className="grid grid-cols-4 divide-x divide-border/40">
        {[
          { label: "Status",   value: wsStatus === "connected" ? "Online" : wsStatus === "connecting" ? "..." : "Offline", icon: <Server className="w-3 h-3" /> },
          { label: "Requests", value: String(wsMsgCount),                                                                   icon: <Zap className="w-3 h-3" /> },
          { label: "Uptime",   value: formatUptime(uptime),                                                                 icon: <Clock className="w-3 h-3" /> },
          { label: "Latency",  value: latency > 0 ? `${latency}ms` : "—",                                                  icon: <Activity className="w-3 h-3" /> },
        ].map((stat) => (
          <div key={stat.label} className="px-3 py-2 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <span className="text-muted-foreground/60">{stat.icon}</span>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{stat.label}</p>
            </div>
            <p className="text-[13px] font-mono text-foreground font-semibold leading-tight">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
