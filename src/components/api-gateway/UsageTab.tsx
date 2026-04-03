import { Badge } from "@/components/ui/badge";
import { BarChart3 } from "lucide-react";

type UsageLog = {
  id: string;
  model: string;
  tokens_input: number | null;
  tokens_output: number | null;
  api_key_id: string | null;
};

type ApiKey = { id: string; name: string };

type Props = {
  logs: UsageLog[];
  apiKeys: ApiKey[];
  filterKeyId: string | null;
  onClearFilter: () => void;
};

export default function UsageTab({ logs, apiKeys, filterKeyId, onClearFilter }: Props) {
  const filterKeyName = filterKeyId ? apiKeys.find(k => k.id === filterKeyId)?.name : null;
  const filteredLogs = filterKeyId ? logs.filter(l => l.api_key_id === filterKeyId) : logs;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-foreground">Usage Analytics</span>
        {filterKeyName && (
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 gap-1">
            {filterKeyName}
            <button onClick={onClearFilter} className="ml-0.5 hover:text-destructive">×</button>
          </Badge>
        )}
      </div>
      {filteredLogs.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center">
          <BarChart3 className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No usage data yet</p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">Make API requests to see analytics</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-secondary/20 border-b border-border/50">
            <span className="text-[10px] font-semibold text-foreground">Requests by Model</span>
          </div>
          <div className="divide-y divide-border/30">
            {Object.entries(
              filteredLogs.reduce<Record<string, { count: number; tokens: number }>>((acc, l) => {
                if (!acc[l.model]) acc[l.model] = { count: 0, tokens: 0 };
                acc[l.model].count++;
                acc[l.model].tokens += (l.tokens_input || 0) + (l.tokens_output || 0);
                return acc;
              }, {})
            ).map(([model, data]) => (
              <div key={model} className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-[11px] font-mono text-foreground">{model}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground">{data.count} reqs</span>
                  <span className="text-[10px] text-muted-foreground">{data.tokens.toLocaleString()} tokens</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
