import { useSettingsStore } from "@/stores/settingsStore";
import { SectionHeader, ToggleField } from "./Primitives";

export function BrowserSettingsTab() {
  const { browser, setBrowser } = useSettingsStore();
  return <div className="space-y-1">
    <SectionHeader>Embedded Browser</SectionHeader>
    <label className="flex items-center justify-between py-2 text-xs"><span>Homepage URL</span><input className="w-56 rounded border border-border bg-surface-hover px-2.5 py-1.5" value={browser.homepage} onChange={(e) => setBrowser("homepage", e.target.value)} /></label>
    <label className="flex items-center justify-between py-2 text-xs"><span>Search engine</span><select className="rounded border border-border bg-surface-hover px-2.5 py-1.5" value={browser.searchEngine} onChange={(e) => setBrowser("searchEngine", e.target.value as typeof browser.searchEngine)}><option value="duckduckgo">DuckDuckGo</option><option value="google">Google</option><option value="kagi">Kagi</option><option value="brave">Brave Search</option></select></label>
    <label className="flex items-center justify-between py-2 text-xs"><span>Default zoom ({browser.defaultZoom}%)</span><input type="range" min={70} max={150} step={10} value={browser.defaultZoom} onChange={(e) => setBrowser("defaultZoom", Number(e.target.value))} /></label>
    <label className="flex items-center justify-between py-2 text-xs"><span>User agent</span><input className="w-56 rounded border border-border bg-surface-hover px-2.5 py-1.5 font-mono" value={browser.userAgent} onChange={(e) => setBrowser("userAgent", e.target.value)} /></label>
    <ToggleField label="Allow cookies and site storage" value={browser.cookiesEnabled} onChange={(v) => setBrowser("cookiesEnabled", v)} />
    <ToggleField label="Show bookmarks bar" value={browser.showBookmarksBar} onChange={(v) => setBrowser("showBookmarksBar", v)} />
    <ToggleField label="Enable developer tools" value={browser.devToolsEnabled} onChange={(v) => setBrowser("devToolsEnabled", v)} />
  </div>;
}

export function EditorSettingsTab() {
  const { editor, setEditor } = useSettingsStore();
  return <div className="space-y-1">
    <SectionHeader>Code Editor</SectionHeader>
    <label className="flex items-center justify-between py-2 text-xs"><span>Font size ({editor.fontSize}px)</span><input type="range" min={11} max={16} value={editor.fontSize} onChange={(e) => setEditor("fontSize", Number(e.target.value))} /></label>
    <label className="flex items-center justify-between py-2 text-xs"><span>Tab size</span><select className="rounded border border-border bg-surface-hover px-2.5 py-1.5" value={editor.tabSize} onChange={(e) => setEditor("tabSize", Number(e.target.value) as 2 | 4)}><option value={2}>2 spaces</option><option value={4}>4 spaces</option></select></label>
    <ToggleField label="Show line numbers" value={editor.lineNumbers} onChange={(v) => setEditor("lineNumbers", v)} />
    <ToggleField label="Word wrap" value={editor.wordWrap} onChange={(v) => setEditor("wordWrap", v)} />
    <ToggleField label="Show minimap by default" value={editor.minimapDefault} onChange={(v) => setEditor("minimapDefault", v)} />
  </div>;
}
