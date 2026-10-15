import { AlertTriangle, ExternalLink } from "lucide-react";
import { type ConnectionStatus, formatUptime } from "./types";

type Props = {
  requestCount: number;
  modelCount: number;
  wsStatus: ConnectionStatus;
  wsMsgCount: number;
  latency: number;
  logCount: number;
  uptime: number;
  errorCount: number;
  warnCount: number;
  serverUrl: string;
};

export function ServerStats({
  requestCount, modelCount, wsStatus, wsMsgCount,
  latency, logCount, uptime, errorCount, warnCount, serverUrl,
}: Props) {
  return (
    <div className="w-72 border-l border-border flex flex-col shrink-0 bg-secondary/10 overflow-y-auto scrollbar-styled">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Server Stats</h3>
      </div>
      <div className="p-3 space-y-3 flex-1">
        <div className="space-y-2">
          <StatItem label="Total Requests"  value={String(requestCount)} />
          <StatItem label="Active Models"   value={String(modelCount)} />
          <StatItem label="WS Status"       value={wsStatus === "connected" ? "Connected" : wsStatus === "connecting" ? "Connecting" : "Offline"} />
          <StatItem label="WS Messages"     value={String(wsMsgCount)} />
          <StatItem label="Avg Latency"     value={latency > 0 ? `${latency}ms` : "—"} />
          <StatItem label="Log Entries"     value={String(logCount)} />
          <StatItem label="Uptime"          value={formatUptime(uptime)} />
        </div>

        {errorCount > 0 && (
          <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="w-3 h-3 text-destructive" />
              <span className="text-[10px] font-semibold text-destructive">Errors</span>
            </div>
            <p className="text-[10px] text-destructive/80">{errorCount} error(s) in logs</p>
          </div>
        )}

        {warnCount > 0 && (
          <div className="p-2.5 rounded-lg bg-status-downloading/10 border border-status-downloading/20">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="w-3 h-3 text-status-downloading" />
              <span className="text-[10px] font-semibold text-status-downloading">Warnings</span>
            </div>
            <p className="text-[10px] text-status-downloading/80">{warnCount} warning(s)</p>
          </div>
        )}
      </div>
      <div className="p-3 border-t border-border">
        <a
          href={serverUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[10px] text-primary hover:text-primary/80 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Open in browser
        </a>
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-[11px] font-mono text-foreground font-medium">{value}</span>
    </div>
  );
}
