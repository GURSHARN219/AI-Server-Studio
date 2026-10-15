import { useState, useEffect } from "react";
import { SelectField, ToggleField, InputField } from "./Primitives";
import { getAccountSetting, setAccountSetting } from "@/stores/accountState";

const STORAGE_KEY = "app:settings:basics";

interface BasicsSettings {
  theme: string;
  language: string;
  autoUpdate: boolean;
  telemetry: boolean;
  gpuAccel: boolean;
  maxConcurrent: string;
  contextDefault: string;
}

const DEFAULTS: BasicsSettings = {
  theme: "dark",
  language: "en",
  autoUpdate: true,
  telemetry: false,
  gpuAccel: true,
  maxConcurrent: "2",
  contextDefault: "4096",
};

function load(): BasicsSettings {
  try {
    return { ...DEFAULTS, ...getAccountSetting(STORAGE_KEY, {}) };
  } catch { return DEFAULTS; }
}

function applyTheme(theme: string) {
  const root = document.documentElement;
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
    root.classList.toggle("light", !prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
  }
}

export default function BasicsTab() {
  const [s, setS] = useState<BasicsSettings>(load);

  // Apply theme on mount
  useEffect(() => { applyTheme(s.theme); }, [s.theme]);

  function update<K extends keyof BasicsSettings>(key: K, value: BasicsSettings[K]) {
    setS(prev => {
      const next = { ...prev, [key]: value };
      setAccountSetting(STORAGE_KEY, next);
      if (key === "theme") applyTheme(value as string);
      return next;
    });
  }

  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold text-foreground mb-4">General</h2>
      <SelectField label="Theme" value={s.theme} onChange={v => update("theme", v)} options={[
        { value: "dark",   label: "Dark" },
        { value: "light",  label: "Light" },
        { value: "system", label: "System" },
      ]} />
      <SelectField label="Language" value={s.language} onChange={v => update("language", v)} options={[
        { value: "en", label: "English" },
        { value: "zh", label: "Chinese" },
        { value: "ja", label: "Japanese" },
        { value: "ko", label: "Korean" },
      ]} />
      <ToggleField label="Auto Update" desc="Automatically check and install updates" value={s.autoUpdate} onChange={v => update("autoUpdate", v)} />
      <ToggleField label="Telemetry" desc="Send anonymous usage data to help improve AI Server Studio" value={s.telemetry} onChange={v => update("telemetry", v)} />
      <div className="border-t border-border my-3" />
      <h2 className="text-sm font-semibold text-foreground mb-4">Performance</h2>
      <ToggleField label="GPU Acceleration" desc="Use GPU for model inference when available" value={s.gpuAccel} onChange={v => update("gpuAccel", v)} />
      <InputField label="Max Concurrent Models" value={s.maxConcurrent} onChange={v => update("maxConcurrent", v)} />
      <InputField label="Default Context Length" value={s.contextDefault} onChange={v => update("contextDefault", v)} />
    </div>
  );
}
