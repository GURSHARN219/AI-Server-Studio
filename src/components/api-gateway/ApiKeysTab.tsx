import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { createBackendApiKey, deleteBackendApiKey, patchBackendApiKey } from "@/lib/api";
import {
  Key, Plus, Copy, Check, Trash2, RefreshCw, AlertTriangle, Eye, EyeOff,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  rate_limit_rpm: number;
  allowed_models: string[] | null;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type Props = {
  apiKeys: ApiKey[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onViewUsage: (keyId: string) => void;
  onViewLogs: (keyId: string) => void;
};

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let key = "sk-ais-";
  for (let i = 0; i < 48; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
  return key;
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function ApiKeysTab({ apiKeys, loading, onRefresh, onViewUsage, onViewLogs }: Props) {
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyRateLimit, setNewKeyRateLimit] = useState(60);
  const [newKeyPassword, setNewKeyPassword] = useState("");
  const [showNewKeyPassword, setShowNewKeyPassword] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyRevealed, setNewKeyRevealed] = useState<string | null>(null);
  const [showRevealedKey, setShowRevealedKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const rawKey = generateApiKey();
      const keyHash = await hashKey(rawKey);
      const keyPrefix = rawKey.slice(0, 12) + "...";
      await createBackendApiKey({
        name: newKeyName.trim(),
        key_hash: keyHash,
        key_prefix: keyPrefix,
        rate_limit_rpm: newKeyRateLimit,
      });
      setNewKeyRevealed(rawKey);
      setNewKeyName("");
      setShowCreateForm(false);
      await onRefresh();
      toast({ title: "API key created", description: "Copy it now — you won't see it again." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const toggleKey = async (id: string, isActive: boolean) => {
    await patchBackendApiKey(id, { is_active: !isActive });
    await onRefresh();
  };

  const deleteKey = async (id: string) => {
    await deleteBackendApiKey(id);
    await onRefresh();
    toast({ title: "API key deleted" });
  };

  return (
    <div className="space-y-3">
      <AnimatePresence>
        {newKeyRevealed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border border-status-downloading/30 bg-status-downloading/5 rounded-lg p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-status-downloading" />
                <span className="text-[11px] font-semibold text-status-downloading">Save your API key now — it won't be shown again</span>
              </div>
              <button onClick={() => setNewKeyRevealed(null)} className="text-[10px] text-muted-foreground hover:text-foreground">Dismiss</button>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] font-mono bg-background/50 px-2.5 py-1.5 rounded border border-border text-foreground select-all">
                {showRevealedKey ? newKeyRevealed : newKeyRevealed.slice(0, 12) + '•'.repeat(newKeyRevealed.length - 12)}
              </code>
              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => setShowRevealedKey(!showRevealedKey)}>
                {showRevealedKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => copyToClipboard(newKeyRevealed, "new-key")}>
                {copied === "new-key" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground">Your API Keys</span>
        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => setShowCreateForm(!showCreateForm)}>
          <Plus className="w-3 h-3" /> Create Key
        </Button>
      </div>

      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border border-border rounded-lg p-3 bg-secondary/10 space-y-2"
          >
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Key Name</label>
                <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="e.g. Production, Testing..." className="h-7 text-[11px]" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Rate Limit (req/min, 0 = unlimited)</label>
                <Input type="number" value={newKeyRateLimit} onChange={(e) => setNewKeyRateLimit(Number(e.target.value))} min={0} className="h-7 text-[11px]" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Password <span className="text-muted-foreground/60">(optional)</span></label>
              <div className="relative">
                <Input type={showNewKeyPassword ? "text" : "password"} value={newKeyPassword} onChange={(e) => setNewKeyPassword(e.target.value)} placeholder="Leave empty for no password" className="h-7 text-[11px] pr-7" />
                <button type="button" onClick={() => setShowNewKeyPassword(!showNewKeyPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showNewKeyPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setShowCreateForm(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-[10px]" onClick={createApiKey} disabled={creating || !newKeyName.trim()}>
                {creating ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Generate Key"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {apiKeys.length === 0 && !loading ? (
        <div className="border border-border rounded-lg p-8 text-center">
          <Key className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No API keys yet</p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">Create one to start using the API</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border/50 overflow-hidden">
          {apiKeys.map((key) => (
            <div key={key.id} className="px-3 py-2 flex items-center gap-3 hover:bg-surface-hover/30 transition-colors">
              <Switch checked={key.is_active} onCheckedChange={() => toggleKey(key.id, key.is_active)} className="scale-75" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-foreground">{key.name}</span>
                  <Badge variant={key.is_active ? "default" : "secondary"} className="text-[8px] px-1 py-0">
                    {key.is_active ? "Active" : "Disabled"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <code className="text-[10px] font-mono text-muted-foreground">{key.key_prefix}</code>
                  <span className="text-[9px] text-muted-foreground">·</span>
                  <span className="text-[9px] text-muted-foreground">{key.rate_limit_rpm === 0 ? "Unlimited" : `${key.rate_limit_rpm} req/min`}</span>
                  {key.last_used_at && (
                    <>
                      <span className="text-[9px] text-muted-foreground">·</span>
                      <span className="text-[9px] text-muted-foreground">Used {new Date(key.last_used_at).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => onViewUsage(key.id)} className="px-1.5 py-0.5 rounded text-[9px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">Usage</button>
                <button onClick={() => onViewLogs(key.id)} className="px-1.5 py-0.5 rounded text-[9px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">Logs</button>
                <button onClick={() => deleteKey(key.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
