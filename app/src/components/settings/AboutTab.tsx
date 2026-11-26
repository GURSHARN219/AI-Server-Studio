import { useSettingsStore } from "@/stores/settingsStore";
import { ToggleField, SectionHeader } from "./Primitives";

// Read from package.json build metadata baked in at build time, fallback to constants
const APP_INFO = {
  name: "AI Server Studio",
  version: "0.0.0",
  company: "AI Server Studio",
  description: "Local AI model server and chat interface powered by llama.cpp",
  license: "MIT",
};

export default function AboutTab() {
  const { about: s, setAbout: set } = useSettingsStore();

  return (
    <div className="space-y-1">
      <div className="py-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-surface-hover border border-border/50 flex items-center justify-center text-lg font-bold text-foreground select-none">
            AI
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{APP_INFO.name}</p>
            <p className="text-[11px] text-muted-foreground">{APP_INFO.description}</p>
          </div>
        </div>
        <div className="rounded-lg border border-border/50 divide-y divide-border/30 overflow-hidden">
          {([
            { label: "Version", value: APP_INFO.version },
            { label: "Company", value: APP_INFO.company },
            { label: "License", value: APP_INFO.license },
          ] as const).map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-3 py-2">
              <span className="text-[11px] text-muted-foreground">{label}</span>
              <span className="text-[11px] font-mono text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <SectionHeader>Updates</SectionHeader>
      <ToggleField label="Auto Update" desc="Automatically check and install updates" value={s.autoUpdate} onChange={v => set("autoUpdate", v)} />

      <SectionHeader>Privacy</SectionHeader>
      <ToggleField label="Telemetry" desc="Send anonymous usage data to help improve AI Server Studio" value={s.telemetry} onChange={v => set("telemetry", v)} />
    </div>
  );
}
