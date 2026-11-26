import { useState } from "react";
import { Check } from "lucide-react";
import { InputField, ToggleField } from "./Primitives";
import { useToast } from "@/hooks/use-toast";
import { setEnginePort } from "@/lib/localEngine";
import { getAccountSetting, setAccountSetting } from "@/stores/accountState";

const STORAGE_KEY = "app:settings:api";

const OPENAI_ENDPOINTS = [
  { method: "GET",  path: "/v1/models" },
  { method: "POST", path: "/v1/chat/completions" },
  { method: "POST", path: "/v1/completions" },
  { method: "POST", path: "/v1/embeddings" },
];

interface ApiSettings {
  apiPort: string;
  apiDomain: string;
  corsEnabled: boolean;
}

const DEFAULTS: ApiSettings = {
  apiPort: "1234",
  apiDomain: "",
  corsEnabled: true,
};

function load(): ApiSettings {
  try {
    return { ...DEFAULTS, ...getAccountSetting(STORAGE_KEY, {}) };
  } catch { return DEFAULTS; }
}

function save(s: ApiSettings) {
  setAccountSetting(STORAGE_KEY, s);
}

export default function ApiTab() {
  const { toast } = useToast();
  const [s, setS] = useState<ApiSettings>(load);

  function update<K extends keyof ApiSettings>(key: K, value: ApiSettings[K]) {
    setS(prev => {
      const next = { ...prev, [key]: value };
      save(next);
      // Propagate port change to the engine client immediately
      if (key === "apiPort") {
        const n = parseInt(value as string, 10);
        if (!isNaN(n)) setEnginePort(n);
      }
      return next;
    });
  }

  function handleSave() {
    save(s);
    toast({ title: "Server settings saved" });
  }

  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold text-foreground mb-4">Server API</h2>
      <InputField label="Local Port"      value={s.apiPort}    onChange={v => update("apiPort", v)}    mono placeholder="1234" />
      <InputField label="Domain (online)" value={s.apiDomain}  onChange={v => update("apiDomain", v)}  mono placeholder="api.example.com (optional)" />
      <ToggleField label="CORS Enabled" desc="Allow cross-origin requests to the API" value={s.corsEnabled} onChange={v => update("corsEnabled", v)} />

      <div className="border-t border-border my-3" />
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-foreground">OpenAI-Compatible Endpoints</h2>
        <button onClick={handleSave} className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] hover:bg-primary/20 transition-colors">
          <Check className="w-3 h-3" /> Save
        </button>
      </div>

      <div className="rounded-lg border border-border/50 overflow-hidden mb-2">
        {OPENAI_ENDPOINTS.map((ep, idx) => (
          <div key={idx} className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/20 last:border-0">
            <span className={`text-[10px] font-mono font-semibold w-10 text-center ${ep.method === "GET" ? "text-sky-400" : "text-emerald-400"}`}>
              {ep.method}
            </span>
            <span className="text-[11px] font-mono text-muted-foreground">{ep.path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
