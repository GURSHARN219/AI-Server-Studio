import { useState, useEffect, useCallback } from "react";
import { Shield, Key, BarChart3, Activity, Terminal } from "lucide-react";
import StatsRow from "@/components/api-gateway/StatsRow";
import ApiKeysTab, { type ApiKey } from "@/components/api-gateway/ApiKeysTab";
import UsageTab from "@/components/api-gateway/UsageTab";
import LogsTab from "@/components/api-gateway/LogsTab";
import DocsTab from "@/components/api-gateway/DocsTab";
import { listBackendApiKeys, listBackendUsageLogs } from "@/lib/api";

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

type UsageStats = {
  totalRequests: number;
  totalTokens: number;
  avgLatency: number;
  errorRate: number;
};

type TabId = "keys" | "usage" | "logs" | "docs";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "keys",  label: "API Keys",       icon: Key },
  { id: "usage", label: "Usage",          icon: BarChart3 },
  { id: "logs",  label: "Request Logs",   icon: Activity },
  { id: "docs",  label: "Documentation",  icon: Terminal },
];

export default function ApiGatewayPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [stats, setStats] = useState<UsageStats>({ totalRequests: 0, totalTokens: 0, avgLatency: 0, errorRate: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("keys");
  const [filterKeyId, setFilterKeyId] = useState<string | null>(null);

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || "";
  const apiBaseUrl = projectId ? `https://${projectId}.supabase.co/functions/v1/api-proxy` : "";

  const fetchApiKeys = useCallback(async () => {
    const data = await listBackendApiKeys();
    setApiKeys(data as ApiKey[]);
  }, []);

  const fetchUsageLogs = useCallback(async () => {
    const data = await listBackendUsageLogs();
    if (data) {
      setUsageLogs(data as UsageLog[]);
      const total = data.length;
      const totalTokens = data.reduce((s, l) => s + (l.tokens_input || 0) + (l.tokens_output || 0), 0);
      const avgLatency = total > 0 ? Math.round(data.reduce((s, l) => s + (l.latency_ms || 0), 0) / total) : 0;
      const errors = data.filter(l => l.status_code >= 400).length;
      setStats({ totalRequests: total, totalTokens, avgLatency, errorRate: total > 0 ? Math.round((errors / total) * 100) : 0 });
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchApiKeys(), fetchUsageLogs()]).then(() => setLoading(false));
  }, [fetchApiKeys, fetchUsageLogs]);

  const handleViewUsage = (keyId: string) => { setFilterKeyId(keyId); setActiveTab("usage"); };
  const handleViewLogs  = (keyId: string) => { setFilterKeyId(keyId); setActiveTab("logs"); };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0 bg-secondary/30">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center">
            <Shield className="w-3 h-3 text-primary" />
          </div>
          <span className="text-xs font-semibold text-foreground">API Gateway</span>
          <span className="text-[10px] text-muted-foreground">BYOK</span>
        </div>
        <div className="flex items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setFilterKeyId(null); }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                activeTab === tab.id && !filterKeyId
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
              }`}
            >
              <tab.icon className="w-3 h-3" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-styled min-h-0">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 space-y-3">
          <StatsRow stats={stats} />

          {activeTab === "keys" && (
            <ApiKeysTab
              apiKeys={apiKeys}
              loading={loading}
              onRefresh={fetchApiKeys}
              onViewUsage={handleViewUsage}
              onViewLogs={handleViewLogs}
            />
          )}
          {activeTab === "usage" && (
            <UsageTab
              logs={usageLogs}
              apiKeys={apiKeys}
              filterKeyId={filterKeyId}
              onClearFilter={() => setFilterKeyId(null)}
            />
          )}
          {activeTab === "logs" && (
            <LogsTab
              logs={usageLogs}
              apiKeys={apiKeys}
              filterKeyId={filterKeyId}
              onClearFilter={() => setFilterKeyId(null)}
              onRefresh={fetchUsageLogs}
            />
          )}
          {activeTab === "docs" && <DocsTab apiBaseUrl={apiBaseUrl} />}
        </div>
      </div>
    </div>
  );
}
