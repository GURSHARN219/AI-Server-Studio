import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw } from "lucide-react";

type UsageLog = {
  id: string;
  model: string;
  provider: string;
  endpoint: string;
  status_code: number;
  tokens_input: number | null;
  tokens_output: number | null;
  latency_ms: number | null;
  error_message: string | null;
  api_key_id: string | null;
  created_at: string;
};

type ApiKey = { id: string; name: string };

type Props = {
  logs: UsageLog[];
  apiKeys: ApiKey[];
  filterKeyId: string | null;
  onClearFilter: () => void;
  onRefresh: () => void;
};

export default function LogsTab({ logs, apiKeys, filterKeyId, onClearFilter, onRefresh }: Props) {
  const filterKeyName = filterKeyId ? apiKeys.find(k => k.id === filterKeyId)?.name : null;
  const filteredLogs = filterKeyId ? logs.filter(l => l.api_key_id === filterKeyId) : logs;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-foreground">Request Logs</span>
          {filterKeyName && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 gap-1">
              {filterKeyName}
              <button onClick={onClearFilter} className="ml-0.5 hover:text-destructive">×</button>
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={onRefresh}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>
      {filteredLogs.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center">
          <Activity className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No requests yet</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[60px_1fr_80px_70px_60px_60px] gap-2 px-3 py-1.5 bg-secondary/20 border-b border-border/50 text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">
            <span>Status</span><span>Model</span><span>Endpoint</span><span>Latency</span><span>In</span><span>Out</span>
          </div>
          <div className="divide-y divide-border/20 max-h-[400px] overflow-y-auto scrollbar-styled">
            {filteredLogs.map((log) => (
              <div key={log.id} className="grid grid-cols-[60px_1fr_80px_70px_60px_60px] gap-2 px-3 py-1.5 hover:bg-surface-hover/30 transition-colors text-[11px]">
                <span className={`font-mono font-semibold ${log.status_code < 400 ? "text-status-online" : "text-destructive"}`}>{log.status_code}</span>
                <span className="font-mono text-foreground truncate">{log.model}</span>
                <span className="text-muted-foreground truncate">{log.endpoint}</span>
                <span className="text-muted-foreground font-mono">{log.latency_ms}ms</span>
                <span className="text-muted-foreground font-mono">{log.tokens_input || 0}</span>
                <span className="text-muted-foreground font-mono">{log.tokens_output || 0}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
