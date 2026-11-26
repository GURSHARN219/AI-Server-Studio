import { useState, useEffect } from "react";
import { User, Key, BarChart3, Zap, Clock, MessageSquare, Cpu, Pencil, Check, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { getBackendProfile, getBackendProfileStats, updateBackendProfile } from "@/lib/api";

type Profile = {
  display_name: string | null;
  avatar_url: string | null;
};

type UsageStats = {
  totalRequests: number;
  totalTokens: number;
  avgLatency: number;
  modelsUsed: string[];
};

export default function AccountPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile>({ display_name: null, avatar_url: null });
  const [usage, setUsage] = useState<UsageStats>({ totalRequests: 0, totalTokens: 0, avgLatency: 0, modelsUsed: [] });
  const [apiKeyCount, setApiKeyCount] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      const profileData = await getBackendProfile().catch(() => null);
      if (profileData) setProfile(profileData);

      const stats = await getBackendProfileStats().catch(() => null);
      if (stats) {
        setUsage({
          totalRequests: stats.totalRequests,
          totalTokens: stats.totalTokens,
          avgLatency: stats.avgLatency,
          modelsUsed: stats.modelsUsed || [],
        });
        setApiKeyCount(stats.apiKeyCount || 0);
      }
    };

    fetchData();
  }, [user]);

  const saveDisplayName = async () => {
    if (!user) return;
    try {
      await updateBackendProfile({ display_name: editName.trim() });
      setProfile(prev => ({ ...prev, display_name: editName.trim() || null }));
      setEditing(false);
      toast({ title: "Profile updated" });
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Unable to update profile", variant: "destructive" });
    }
  };

  function formatNumber(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  }

  const displayName = profile.display_name || user?.email?.split("@")[0] || "User";

  const STAT_CARDS = [
    { label: "Total Requests", value: formatNumber(usage.totalRequests), icon: MessageSquare },
    { label: "Tokens Used", value: formatNumber(usage.totalTokens), icon: Zap },
    { label: "Avg Latency", value: usage.avgLatency > 0 ? `${usage.avgLatency}ms` : "—", icon: Clock },
    { label: "Models Used", value: String(usage.modelsUsed.length), icon: Cpu },
  ];

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Profile header */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center">
            <User className="w-7 h-7 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {editing ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 text-sm w-48"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && saveDisplayName()}
                  />
                  <button onClick={saveDisplayName} className="p-1 text-status-online hover:text-foreground"><Check className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setEditing(false)} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <>
                  <h1 className="text-sm font-semibold text-foreground">{displayName}</h1>
                  <button
                    onClick={() => { setEditName(profile.display_name || ""); setEditing(true); }}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{user?.email || ""}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-status-online/10 text-status-online font-medium uppercase">Active</span>
              <span className="text-[9px] text-muted-foreground">Joined {user?.created_at ? new Date(user.created_at).toLocaleDateString() : ""}</span>
            </div>
          </div>
        </div>

        {/* Usage stats grid */}
        <div>
          <h2 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" /> Usage Overview
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {STAT_CARDS.map((stat) => (
              <div key={stat.label} className="bg-secondary border border-border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <stat.icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">{stat.label}</span>
                </div>
                <p className="text-lg font-semibold text-foreground font-mono">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Models used */}
        {usage.modelsUsed.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" /> Models Used
            </h2>
            <div className="bg-secondary border border-border rounded-lg p-3 flex flex-wrap gap-1.5">
              {usage.modelsUsed.map((model) => (
                <span key={model} className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">{model}</span>
              ))}
            </div>
          </div>
        )}

        {/* API keys summary */}
        <div>
          <h2 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5" /> API Keys
          </h2>
          <div className="bg-secondary border border-border rounded-lg p-3">
            <p className="text-xs text-foreground font-mono">{apiKeyCount} key{apiKeyCount !== 1 ? "s" : ""} configured</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Manage in API Gateway</p>
          </div>
        </div>
      </div>
    </div>
  );
}