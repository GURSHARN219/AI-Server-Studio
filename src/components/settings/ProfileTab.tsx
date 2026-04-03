import React, { useState, useEffect } from "react";
import { User, Pencil, Lock, Eye, EyeOff, Shield, Key, BarChart3, Cpu, Mail, CheckCircle2, Copy, LogOut, Zap, Clock, MessageSquare, Plus, Download, Trash2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ImageCropModal } from "./ImageCropModal";
import { authBackendUpdatePassword, getBackendProfile, getBackendProfileStats, updateBackendProfile } from "@/lib/api";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export default function ProfileTab() {
  const { toast } = useToast();
  const { user, signOut } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [usage, setUsage] = useState({ totalRequests: 0, totalTokens: 0, avgLatency: 0, modelsUsed: [] as string[] });
  const [apiKeyCount, setApiKeyCount] = useState(0);
  const [selectedImageFile, setSelectedImageFile] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        setSelectedImageFile(reader.result?.toString() || null);
      });
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (!user) return;
    getBackendProfile().then((data) => {
      setDisplayName(data.display_name || "");
      setAvatarUrl(data.avatar_url || "");
    }).catch(() => {});
    getBackendProfileStats().then((stats) => {
      setUsage({
        totalRequests: stats.totalRequests,
        totalTokens: stats.totalTokens,
        avgLatency: stats.avgLatency,
        modelsUsed: stats.modelsUsed || [],
      });
      setApiKeyCount(stats.apiKeyCount || 0);
    }).catch(() => {});
  }, [user]);

  const STAT_CARDS = [
    { label: "Total Requests", value: formatNumber(usage.totalRequests), icon: MessageSquare },
    { label: "Tokens Used", value: formatNumber(usage.totalTokens), icon: Zap },
    { label: "Avg Latency", value: usage.avgLatency > 0 ? `${usage.avgLatency}ms` : "—", icon: Clock },
    { label: "Models Used", value: String(usage.modelsUsed.length), icon: Cpu },
  ];

  const saveProfile = async () => {
    if (!user) return;
    setProfileLoading(true);
    let error: Error | null = null;
    try {
      await updateBackendProfile({ display_name: displayName.trim(), avatar_url: avatarUrl.trim() });
    } catch (e) {
      error = e instanceof Error ? e : new Error("Unable to update profile");
    }
    setProfileLoading(false);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Profile updated" });
  };

  const changePassword = async () => {
    if (newPassword !== confirmPassword) { toast({ title: "Error", description: "Passwords don't match", variant: "destructive" }); return; }
    if (newPassword.length < 6) { toast({ title: "Error", description: "Min 6 characters", variant: "destructive" }); return; }
    try {
      await authBackendUpdatePassword(newPassword);
      toast({ title: "Password updated" });
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Unable to update password", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-[11px] text-muted-foreground leading-relaxed -mt-1">
        Manage how you appear in the app, protect your account, and review usage. Provider keys stay encrypted.
      </p>

      <section className="rounded-xl border border-border/70 bg-gradient-to-br from-primary/[0.07] via-background to-background p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="relative shrink-0">
            <div className="w-16 h-16 rounded-2xl ring-2 ring-primary/20 ring-offset-2 ring-offset-background overflow-hidden bg-primary/15 flex items-center justify-center relative group">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8 text-primary" />
              )}
              <label className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer backdrop-blur-[2px]">
                <Plus className="w-6 h-6 text-white stroke-[1.5]" />
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </label>
            </div>
            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-status-online border-2 border-background" title="Signed in">
              <CheckCircle2 className="w-3 h-3 text-background" />
            </span>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-semibold text-foreground truncate">{displayName || user?.email?.split("@")[0] || "User"}</h3>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Mail className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate font-mono">{user?.email || "—"}</span>
            </div>
            <button
              type="button"
              onClick={() => { if (user?.email) { void navigator.clipboard.writeText(user.email); toast({ title: "Email copied" }); } }}
              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline mt-1"
            >
              <Copy className="w-3 h-3" /> Copy email
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border/60 bg-surface-hover/25 p-5 space-y-4">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
          <Pencil className="w-3.5 h-3.5 text-muted-foreground" /> Profile details
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Display name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How others see you" className="mt-1 w-full bg-background/80 border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Avatar URL</label>
            <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" className="mt-1 w-full bg-background/80 border border-border rounded-lg px-3 py-2 text-xs text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40" />
          </div>
        </div>
        <button type="button" onClick={saveProfile} disabled={profileLoading} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-sm">
          {profileLoading ? "Saving…" : "Save profile"}
        </button>
      </section>

      <section className="rounded-xl border border-border/60 bg-surface-hover/25 p-5 space-y-4">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-muted-foreground" /> Password & sign-in
        </h3>
        <p className="text-[10px] text-muted-foreground">Use at least 6 characters. Changing password keeps you signed in on this device.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground font-medium">New password</label>
            <input type={showPasswords ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" className="mt-1 w-full bg-background/80 border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground font-medium">Confirm</label>
            <input type={showPasswords ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" className="mt-1 w-full bg-background/80 border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={changePassword} disabled={!newPassword || !confirmPassword} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">Update password</button>
          <button type="button" onClick={() => setShowPasswords(!showPasswords)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-background/50 transition-colors">
            {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showPasswords ? "Hide" : "Show"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border/60 bg-surface-hover/25 p-5 space-y-3">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" /> Usage overview
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {STAT_CARDS.map((stat) => (
            <div key={stat.label} className="rounded-lg border border-border/50 bg-background/40 p-3 hover:border-primary/20 transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <stat.icon className="w-3.5 h-3.5 text-primary/80" />
                <span className="text-[10px] text-muted-foreground">{stat.label}</span>
              </div>
              <p className="text-lg font-semibold text-foreground font-mono tracking-tight">{stat.value}</p>
            </div>
          ))}
        </div>
      </section>

      {usage.modelsUsed.length > 0 && (
        <section className="rounded-xl border border-border/60 bg-surface-hover/25 p-5 space-y-3">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-muted-foreground" /> Models used
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {usage.modelsUsed.map((model) => (
              <span key={model} className="text-[10px] px-2 py-1 rounded-md bg-primary/10 text-primary font-mono border border-primary/15">{model}</span>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border/60 bg-surface-hover/25 p-5">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-2 mb-2">
          <Key className="w-3.5 h-3.5 text-muted-foreground" /> API keys
        </h3>
        <p className="text-xs text-foreground font-mono mb-1">{apiKeyCount} key{apiKeyCount !== 1 ? "s" : ""} on file</p>
        <p className="text-[10px] text-muted-foreground">Create and rotate keys from the API Gateway page in the app.</p>
      </section>

      <section className="rounded-xl border border-border/60 bg-surface-hover/25 p-5 space-y-3">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-primary/80" /> Active session
        </h3>
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">This device</p>
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{user?.email}</p>
          </div>
          <span className="shrink-0 text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/25">Active</span>
        </div>
      </section>

      <section className="rounded-xl border border-destructive/20 bg-destructive/[0.02] p-5 space-y-4">
        <h3 className="text-xs font-semibold text-destructive flex items-center gap-2">
          <Shield className="w-3.5 h-3.5" /> Danger zone
        </h3>
        
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-background/50 border border-border/50">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Account Data</h4>
            <p className="text-[10px] text-muted-foreground mb-3">Download all your profile data and usage logs.</p>
            <button className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md border border-border text-[11px] font-medium hover:bg-surface-hover transition-colors">
              <Download className="w-3.5 h-3.5" /> Export Data
            </button>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border/50">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-destructive/70 mb-1">Permanence</h4>
            <p className="text-[10px] text-muted-foreground mb-3">Delete your account and all associated data.</p>
            <button className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-destructive/10 text-destructive text-[11px] font-medium hover:bg-destructive/20 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Delete Account
            </button>
          </div>
        </div>

        <div className="pt-2 flex items-center justify-between border-t border-border/40">
          <p className="text-[10px] text-muted-foreground italic">Signing out ends this session safely.</p>
          <button type="button" onClick={signOut} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-destructive/10 text-destructive text-xs font-medium border border-destructive/20 hover:bg-destructive/20 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </section>

      {selectedImageFile && (
        <ImageCropModal
          imageUrl={selectedImageFile}
          onCropComplete={(base64Img) => {
            setAvatarUrl(base64Img);
            setSelectedImageFile(null);
          }}
          onCancel={() => setSelectedImageFile(null)}
        />
      )}
    </div>
  );
}
