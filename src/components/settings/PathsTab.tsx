import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { InputField } from "./Primitives";
import { useToast } from "@/hooks/use-toast";
import { syncModelsDir } from "@/lib/localEngine";

const STORAGE_KEY = "app:settings:paths";

interface PathsSettings {
  modelsPath: string;
  logsPath: string;
  cachePath: string;
}

const DEFAULTS: PathsSettings = {
  modelsPath: "",
  logsPath: "~/.ai-server/logs",
  cachePath: "~/.ai-server/cache",
};

function load(): PathsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch { return DEFAULTS; }
}

function save(s: PathsSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export default function PathsTab() {
  const { toast } = useToast();
  const [s, setS] = useState<PathsSettings>(load);

  function update<K extends keyof PathsSettings>(key: K, value: string) {
    setS(prev => {
      const next = { ...prev, [key]: value };
      save(next);
      // Sync models dir to engine when it changes (only if non-empty)
      if (key === "modelsPath" && value) {
        syncModelsDir(value).catch(() => {});
      }
      return next;
    });
  }

  function openFolder(folderPath: string) {
    // In Electron context, use the exposed openPath API
    const win = window as Window & { electron?: { openPath?: (p: string) => void } };
    if (win.electron?.openPath) {
      win.electron.openPath(folderPath);
    } else {
      toast({ title: "Open folder", description: folderPath });
    }
  }

  const folders = [
    { label: "Open Models Folder", desc: "Opens models directory in file explorer", path: s.modelsPath },
    { label: "Open Logs Folder",   desc: "Opens logs directory in file explorer",   path: s.logsPath },
  ];

  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold text-foreground mb-4">File Paths</h2>
      <InputField label="Models Directory" value={s.modelsPath} onChange={v => update("modelsPath", v)} mono />
      <InputField label="Logs Directory"   value={s.logsPath}   onChange={v => update("logsPath", v)}   mono />
      <InputField label="Cache Directory"  value={s.cachePath}  onChange={v => update("cachePath", v)}  mono />

      <div className="border-t border-border my-3" />
      {folders.map(({ label, desc, path: folderPath }) => (
        <div key={label} className="flex items-center justify-between py-2">
          <div>
            <span className="text-xs text-foreground">{label}</span>
            <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
          </div>
          <button
            onClick={() => openFolder(folderPath)}
            className="flex items-center gap-1 px-3 py-1 rounded bg-surface-hover hover:bg-surface-active text-xs text-foreground transition-colors"
          >
            Open <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
