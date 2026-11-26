import { Zap, BarChart3, Clock, AlertTriangle } from "lucide-react";

type UsageStats = {
  totalRequests: number;
  totalTokens: number;
  avgLatency: number;
  errorRate: number;
};

export default function StatsRow({ stats }: { stats: UsageStats }) {
  const items = [
    { label: "Total Requests", value: stats.totalRequests.toLocaleString(), icon: <Zap className="w-3 h-3" />, color: "text-primary" },
    { label: "Total Tokens", value: stats.totalTokens.toLocaleString(), icon: <BarChart3 className="w-3 h-3" />, color: "text-status-online" },
    { label: "Avg Latency", value: `${stats.avgLatency}ms`, icon: <Clock className="w-3 h-3" />, color: "text-status-downloading" },
    { label: "Error Rate", value: `${stats.errorRate}%`, icon: <AlertTriangle className="w-3 h-3" />, color: stats.errorRate > 10 ? "text-destructive" : "text-muted-foreground" },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((s) => (
        <div key={s.label} className="border border-border rounded-lg px-3 py-2 bg-secondary/10">
          <div className="flex items-center gap-1 mb-0.5">
            <span className={s.color}>{s.icon}</span>
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{s.label}</span>
          </div>
          <p className="text-sm font-mono font-semibold text-foreground">{s.value}</p>
        </div>
      ))}
    </div>
  );
}
