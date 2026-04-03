import { useSettingsStore } from "@/stores/settingsStore";
import { ToggleField, InputField, SelectField, SectionHeader } from "./Primitives";

export default function AdvancedTab() {
  const { advanced: s, setAdvanced: set } = useSettingsStore();

  return (
    <div className="space-y-1">
      <SectionHeader>Performance</SectionHeader>
      <ToggleField label="GPU Acceleration" desc="Use GPU for model inference when available" value={s.gpuAccel} onChange={v => set("gpuAccel", v)} />
      <InputField label="Max Concurrent Models" value={s.maxConcurrent} onChange={v => set("maxConcurrent", v)} />
      <InputField label="Default Context Length" value={s.contextDefault} onChange={v => set("contextDefault", v)} />

      <SectionHeader>Developer Mode</SectionHeader>
      <ToggleField label="Developer mode" desc="Shows advanced controls and settings." value={s.developerMode} onChange={v => set("developerMode", v)} />

      <SectionHeader>On-Demand Loading and Model TTL</SectionHeader>
      <ToggleField label="JIT models auto-evict" desc="Ensure at most 1 model is loaded via JIT at any given time (unloads previous model)" value={s.jitAutoEvict} onChange={v => set("jitAutoEvict", v)} />
      <InputField label="Max idle TTL (minutes)" value={s.maxIdleTtl} onChange={v => set("maxIdleTtl", v)} mono placeholder="5" />

      <SectionHeader>Local LLM Service (headless)</SectionHeader>
      <ToggleField label="Enable Local LLM Service" desc="Use LM Studio's LLM server without having to keep the LM Studio application open" value={s.enableLocalLlmService} onChange={v => set("enableLocalLlmService", v)} />

      <SectionHeader>Runtime Settings</SectionHeader>
      <SelectField label="Extension Packs Download Channel" value={s.runtimeUpdateChannel} onChange={v => set("runtimeUpdateChannel", v as any)} options={[
        { value: "stable", label: "Stable" },
        { value: "beta",   label: "Beta" },
      ]} desc="Update channel for engine and other runtime updates" />
      <ToggleField label="Auto-update selected Runtime Extension Packs" value={s.autoUpdateRuntimePacks} onChange={v => set("autoUpdateRuntimePacks", v)} />
      <ToggleField label="Auto-delete least recently used Runtime Extension Packs" value={s.autoDeleteLruPacks} onChange={v => set("autoDeleteLruPacks", v)} />

      <SectionHeader>Experimental Settings</SectionHeader>
      <ToggleField label="Show debug info blocks in chat" value={s.showDebugInfoBlocks} onChange={v => set("showDebugInfoBlocks", v)} />
      <ToggleField label="Show Resource Consumption Widget" desc="Display CPU/RAM usage in the app sidebar footer" value={s.showResourceWidget} onChange={v => set("showResourceWidget", v)} />
      <ToggleField label="Enable model load configuration support in presets" value={s.enableModelLoadInPresets} onChange={v => set("enableModelLoadInPresets", v)} />
      <ToggleField
        label="Separate reasoning_content and content in API responses"
        desc="Only works for reasoning models (DeepSeek R1, etc.) that produce CoT in <think> tags."
        value={s.separateReasoningContent}
        onChange={v => set("separateReasoningContent", v)}
      />

      <SectionHeader>Debug</SectionHeader>
      <ToggleField label="Debug Mode"   desc="Enable verbose debug output in developer logs" value={s.debugMode}    onChange={v => set("debugMode", v)} />
      <ToggleField label="Verbose Logs" desc="Log all requests and responses to the log file" value={s.verboseLogs} onChange={v => set("verboseLogs", v)} />
      <ToggleField label="Keep-Alive"   desc="Keep model loaded between requests"             value={s.keepAlive}   onChange={v => set("keepAlive", v)} />
      <InputField label="Request Timeout (s)" value={s.requestTimeout} onChange={v => set("requestTimeout", v)} mono />
      <InputField label="Max Retries"         value={s.maxRetries}     onChange={v => set("maxRetries", v)}     mono />
    </div>
  );
}
