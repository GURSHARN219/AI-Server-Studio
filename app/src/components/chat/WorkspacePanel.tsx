import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { useAppTheme } from "@/hooks/useAppTheme";
import { ArrowDownToLine, ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Code2, ExternalLink, FileCode2, FileJson, FileText, FilePlus2, Folder, FolderOpen, FolderPlus, Globe, History, Home, Loader2, Maximize2, Minimize2, MoreHorizontal, PanelLeft, Plus, RotateCw, Search, Settings2, X, ChevronsDownUp } from "lucide-react";

export type WorkspaceView = "code" | "browser";
type BrowserTab = { id: number; url: string; title: string };
export interface BrowserEngine {
  navigate(url: string): void; back(): void; forward(): void; reload(): void; stop(): void;
  getHistory(): string[]; getTitle(): string; zoom(delta: number): void; devtools(): void; attach?(element: HTMLElement): void; detach?(): void;
}
type CefHost = { navigate?: (url: string) => void; back?: () => void; forward?: () => void; reload?: () => void; stop?: () => void; devtools?: () => void; zoom?: (value: number) => void; attach?: (element: HTMLElement) => void; detach?: () => void };
export class CefBrowserEngine implements BrowserEngine {
  private host: CefHost;
  constructor(host: CefHost = (window as any).aiServerStudioBrowser || {}) { this.host = host; }
  navigate(url: string) { this.host.navigate?.(url); } back() { this.host.back?.(); } forward() { this.host.forward?.(); }
  reload() { this.host.reload?.(); } stop() { this.host.stop?.(); } getHistory() { return []; } getTitle() { return document.title; }
  zoom(delta: number) { this.host.zoom?.(delta); } devtools() { this.host.devtools?.(); } attach(element: HTMLElement) { this.host.attach?.(element); } detach() { this.host.detach?.(); }
}
export class MockBrowserEngine implements BrowserEngine {
  constructor(private handlers: { navigate: (url: string) => void; back: () => void; forward: () => void; reload: () => void; stop: () => void; history: () => string[]; title: () => string; zoom: (delta: number) => void; devtools: () => void }) {}
  navigate(url: string) { this.handlers.navigate(url); } back() { this.handlers.back(); } forward() { this.handlers.forward(); }
  reload() { this.handlers.reload(); } stop() { this.handlers.stop(); } getHistory() { return this.handlers.history(); } getTitle() { return this.handlers.title(); }
  zoom(delta: number) { this.handlers.zoom(delta); } devtools() { this.handlers.devtools(); }
}

// The browser surface is isolated behind this contract. The Wails CEF host can
// provide window.aiServerStudioBrowser methods; ordinary web previews use iframe.
const useCef = Boolean((window as any).aiServerStudioBrowser);
const initialFiles: Record<string, string> = {
  "src/App.tsx": `import { ChatPage } from "./pages/ChatPage";\n\nexport default function App() {\n  return <ChatPage />;\n}\n`,
  "src/pages/ChatPage.tsx": `export function ChatPage() {\n  return <main>How can I help you today?</main>;\n}\n`,
  "src/components/ChatComposer.tsx": `export function ChatComposer() {\n  return <textarea placeholder="Message…" />;\n}\n`,
  "src/index.css": `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`,
  "package.json": `{"name":"ai-server-studio","private":true,"scripts":{"dev":"vite"}}`,
  "README.md": `# AI Server Studio\n\nA local AI workspace.\n`,
};
type FileTreeNode = { name: string; path: string; isFile: boolean; children: FileTreeNode[] };
function buildFileTree(paths: string[], folders: string[] = []): FileTreeNode {
  const root: FileTreeNode = { name: "AI_Server_Studio", path: "", isFile: false, children: [] };
  for (const folderPath of folders) {
    const parts = folderPath.split("/").filter(Boolean);
    let parent = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let node = parent.children.find((child) => child.name === part);
      if (!node) { node = { name: part, path, isFile: false, children: [] }; parent.children.push(node); }
      parent = node;
    });
  }
  for (const filePath of paths) {
    const parts = filePath.split("/");
    let parent = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let node = parent.children.find((child) => child.name === part);
      if (!node) {
        node = { name: part, path, isFile: index === parts.length - 1, children: [] };
        parent.children.push(node);
      }
      parent = node;
    });
  }
  const sort = (node: FileTreeNode) => { node.children.sort((a, b) => Number(a.isFile) - Number(b.isFile) || a.name.localeCompare(b.name)); node.children.forEach(sort); };
  sort(root);
  return root;
}

export default function WorkspacePanel({ view, setView, fullView, onToggleFull, narrow = false, onShowChat }: { view: WorkspaceView; setView: (v: WorkspaceView) => void; fullView: boolean; onToggleFull: () => void; narrow?: boolean; onShowChat?: () => void }) {
  const appTheme = useAppTheme();
  const [files, setFiles] = useState(initialFiles);
  const [activeFile, setActiveFile] = useState("src/App.tsx");
  const [openFiles, setOpenFiles] = useState(["src/App.tsx"]);
  const [search, setSearch] = useState("");
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ "": true, src: true, "src/components": true, "src/pages": true });
  const [folders, setFolders] = useState<string[]>([]);
  const explorerResizeStart = useRef<number | null>(null);
  const [explorerWidth, setExplorerWidth] = useState(() => {
    try { return Math.max(180, Math.min(480, Number(localStorage.getItem("chat-workspace-explorer-width") || 240))); } catch { return 240; }
  });
  const [url, setUrl] = useState("http://localhost:3000");
  const [address, setAddress] = useState(url);
  const [history, setHistory] = useState<string[]>([url]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [browserTab, setBrowserTab] = useState<BrowserTab[]>([{ id: 1, url, title: "Local preview" }]);
  const [activeBrowserTab, setActiveBrowserTab] = useState(1);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [browserPage, setBrowserPage] = useState<"web" | "history" | "settings" | "downloads">("web");
  const [homepage, setHomepage] = useState("http://localhost:3000");
  const [engineHistory, setEngineHistory] = useState<string[]>([]);
  const [backIndex, setBackIndex] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [showSource, setShowSource] = useState(false);

  const engine: BrowserEngine = useMemo(() => {
    if (useCef) return new CefBrowserEngine();
    return new MockBrowserEngine({
      navigate: (target) => { setUrl(target); setAddress(target); setHistory((h) => [...h, target]); setEngineHistory((h) => [...h.slice(0, backIndex + 1), target]); setBackIndex((i) => i + 1); setLoading(true); window.setTimeout(() => setLoading(false), 450); },
      back: () => { if (backIndex > 0) { setBackIndex((i) => i - 1); setUrl(engineHistory[backIndex - 1]); setAddress(engineHistory[backIndex - 1]); } },
      forward: () => { if (backIndex < engineHistory.length - 1) { setBackIndex((i) => i + 1); setUrl(engineHistory[backIndex + 1]); setAddress(engineHistory[backIndex + 1]); } },
      reload: () => { setLoading(true); window.setTimeout(() => setLoading(false), 350); }, stop: () => setLoading(false), history: () => history,
      title: () => browserTab.find((t) => t.id === activeBrowserTab)?.title || url, zoom: (delta) => setZoom((z) => Math.max(50, Math.min(200, z + delta))), devtools: () => undefined
    });
  }, [history, backIndex, engineHistory, browserTab, activeBrowserTab, url]);
  useEffect(() => { if (!useCef || view !== "browser") return; const node = document.getElementById("cef-browser-surface"); if (node) engine.attach?.(node); return () => engine.detach?.(); }, [engine, view]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") { e.preventDefault(); setView("browser"); document.getElementById("workspace-address")?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") { e.preventDefault(); const id = Date.now(); setBrowserTab((tabs) => [...tabs, { id, url: "about:blank", title: "New tab" }]); setActiveBrowserTab(id); setView("browser"); setAddress(""); setUrl("about:blank"); setBrowserPage("web"); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w" && view === "browser" && browserTab.length > 1) { e.preventDefault(); setBrowserTab((tabs) => tabs.filter((t) => t.id !== activeBrowserTab)); const next = browserTab.find((t) => t.id !== activeBrowserTab)!; setActiveBrowserTab(next.id); setUrl(next.url); setAddress(next.url); }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f" && view === "browser") { e.preventDefault(); setFindOpen(true); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [view, browserTab, activeBrowserTab, setView]);

  const navigate = (value = address) => { const target = /^(https?:|about:)/i.test(value) ? value : `https://${value.includes(".") ? value : `www.google.com/search?q=${encodeURIComponent(value)}`}`; engine.navigate(target); setBrowserPage("web"); setBrowserTab((tabs) => tabs.map((tab) => tab.id === activeBrowserTab ? { ...tab, url: target, title: target.includes("localhost") ? "Local preview" : new URL(target).hostname } : tab)); };
  const openFile = (file: string) => { const match = Object.keys(files).find((path) => path.toLowerCase() === file.toLowerCase()) || Object.keys(files).find((path) => path.endsWith(file.split("/").pop() || "")) || file; if (!(match in files)) setFiles((prev) => ({ ...prev, [match]: `// ${match}\n\n` })); setActiveFile(match); setOpenFiles((prev) => prev.includes(match) ? prev : [...prev, match]); setView("code"); };
  useEffect(() => {
    const openRequestedFile = (event: Event) => { const file = (event as CustomEvent<{ file?: string }>).detail?.file; if (file) openFile(file); };
    window.addEventListener("workspace:open-file", openRequestedFile);
    const pendingFile = localStorage.getItem("workspace:open-file");
    if (pendingFile) { localStorage.removeItem("workspace:open-file"); openFile(pendingFile); }
    return () => window.removeEventListener("workspace:open-file", openRequestedFile);
  }, [files]);
  const fileIcon = (file: string) => file.endsWith(".tsx") || file.endsWith(".ts") ? <FileCode2 className="h-3.5 w-3.5 text-primary" /> : file.endsWith(".json") ? <FileJson className="h-3.5 w-3.5 text-status-downloading" /> : <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  const isModified = (file: string) => files[file] !== initialFiles[file];
  const fileTree = useMemo(() => buildFileTree(Object.keys(files), folders), [files, folders]);
  useEffect(() => {
    const move = (event: PointerEvent) => { if (explorerResizeStart.current != null) setExplorerWidth(Math.max(180, Math.min(480, event.clientX - explorerResizeStart.current))); };
    const up = () => { explorerResizeStart.current = null; };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);
  useEffect(() => { try { localStorage.setItem("chat-workspace-explorer-width", String(explorerWidth)); } catch {} }, [explorerWidth]);
  const createFile = () => {
    const path = window.prompt("New file path", activeFile.includes("/") ? `${activeFile.slice(0, activeFile.lastIndexOf("/") + 1)}Untitled.tsx` : "Untitled.tsx")?.trim().replaceAll("\\", "/");
    if (!path || path.endsWith("/")) return;
    setFiles((current) => current[path] == null ? { ...current, [path]: "" } : current);
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) { setFolders((current) => current.includes(parent) ? current : [...current, parent]); setExpandedFolders((current) => ({ ...current, [parent]: true })); }
    setActiveFile(path); setOpenFiles((current) => current.includes(path) ? current : [...current, path]);
  };
  const createFolder = () => {
    const path = window.prompt("New folder path", "src/new-folder")?.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (!path) return;
    setFolders((current) => current.includes(path) ? current : [...current, path]);
    setExpandedFolders((current) => ({ ...current, [path.split("/").slice(0, -1).join("/")]: true, [path]: true }));
  };
  const refreshExplorer = () => { setSearch(""); setExpandedFolders({ "": true, src: true, "src/components": true, "src/pages": true }); };
  const hasVisibleMatch = (node: FileTreeNode): boolean => !search.trim() || node.name.toLowerCase().includes(search.toLowerCase()) || node.children.some(hasVisibleMatch);
  const renderTreeNode = (node: FileTreeNode, depth = 0): import("react").ReactNode => {
    if (!hasVisibleMatch(node)) return null;
    if (node.isFile) return <button key={node.path} type="button" onClick={() => openFile(node.path)} title={node.path} className={`flex h-7 w-full items-center gap-2 rounded-sm pr-2 text-left text-[11px] transition-colors ${activeFile === node.path ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"}`} style={{ paddingLeft: `${8 + depth * 14}px` }}><span className="w-3 shrink-0"/>{fileIcon(node.name)}<span className="min-w-0 flex-1 truncate">{node.name}</span>{isModified(node.path) && <span className="text-[10px] font-medium text-status-downloading">M</span>}</button>;
    const expanded = search.trim() ? true : (expandedFolders[node.path] ?? false);
    return <div key={node.path}>
      <button type="button" onClick={() => setExpandedFolders((current) => ({ ...current, [node.path]: !expanded }))} className="flex h-7 w-full items-center gap-1.5 rounded-sm pr-2 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground" style={{ paddingLeft: `${6 + depth * 14}px` }}>
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0"/> : <ChevronRight className="h-3 w-3 shrink-0"/>}{expanded ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary/80"/> : <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground"/>}<span className="truncate">{node.name}</span>
      </button>
      {expanded && <div className="relative">{node.children.map((child) => renderTreeNode(child, depth + 1))}</div>}
    </div>;
  };
  const viewSwitcher = <div role="group" aria-label="Workspace view" className="flex shrink-0 items-center gap-0.5 rounded-md bg-secondary/50 p-0.5">
    <button type="button" onClick={() => setView("code")} aria-label="Code editor" aria-pressed={view === "code"} title="Code editor" className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${view === "code" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><Code2 className="h-4 w-4"/></button>
    <button type="button" onClick={() => setView("browser")} aria-label="Browser" aria-pressed={view === "browser"} title="Browser" className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${view === "browser" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><Globe className="h-4 w-4"/></button>
  </div>;
  const fullViewButton = <button type="button" onClick={onToggleFull} aria-label={fullView ? "Exit full view" : "Full view"} title={fullView ? "Exit full view (Ctrl+Shift+F)" : "Full view (Ctrl+Shift+F)"} className="flex h-7 w-8 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground">{fullView ? <Minimize2 className="h-4 w-4"/> : <Maximize2 className="h-4 w-4"/>}</button>;

  return <section className="flex min-w-0 min-h-0 flex-1 flex-col bg-background animate-in slide-in-from-right-4 duration-300">
    {view === "code" ? <div className="flex min-h-0 flex-1">
      {explorerOpen && <aside style={{ width: explorerWidth }} className="relative flex shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/70 px-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Explorer</span>
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={createFile} title="New file" aria-label="New file" className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"><FilePlus2 className="h-3.5 w-3.5"/></button>
            <button type="button" onClick={createFolder} title="New folder" aria-label="New folder" className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"><FolderPlus className="h-3.5 w-3.5"/></button>
            <button type="button" onClick={refreshExplorer} title="Refresh explorer" aria-label="Refresh explorer" className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"><RotateCw className="h-3.5 w-3.5"/></button>
            <button type="button" onClick={() => setExpandedFolders({ "": true })} title="Collapse all folders" aria-label="Collapse all folders" className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground"><ChevronsDownUp className="h-3.5 w-3.5"/></button>
          </div>
        </div>
        <div className="mx-2 my-2 flex items-center gap-1.5 rounded-md border border-border/70 bg-background/50 px-2"><Search className="h-3 w-3 shrink-0 text-muted-foreground"/><input aria-label="Search files" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files" className="h-7 min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"/>{search && <button type="button" onClick={() => setSearch("")} aria-label="Clear file search" className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3"/></button>}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">{renderTreeNode(fileTree)}{search && !hasVisibleMatch(fileTree) && <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">No files match “{search}”</div>}</div>
      </aside>}
      {explorerOpen && <div role="separator" aria-label="Resize explorer" aria-orientation="vertical" aria-valuenow={explorerWidth} tabIndex={0} onPointerDown={(event) => { explorerResizeStart.current = event.clientX - explorerWidth; event.currentTarget.setPointerCapture(event.pointerId); }} onKeyDown={(event) => { if (event.key === "ArrowLeft") setExplorerWidth((width) => Math.max(180, width - 16)); if (event.key === "ArrowRight") setExplorerWidth((width) => Math.min(480, width + 16)); }} className="group z-10 -ml-0.5 w-1 shrink-0 cursor-col-resize touch-none bg-border/40 transition-colors hover:bg-primary/50 focus-visible:bg-primary/60"><div className="mx-auto h-full w-px group-hover:bg-primary/70"/></div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-stretch border-b border-border bg-card/50">
          <div className="flex shrink-0 items-center gap-0.5 border-r border-border px-1">{viewSwitcher}{fullViewButton}</div>
          <button type="button" onClick={() => setExplorerOpen((open) => !open)} className="flex w-8 shrink-0 items-center justify-center border-r border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground" title={explorerOpen ? "Hide explorer" : "Show explorer"} aria-label={explorerOpen ? "Hide explorer" : "Show explorer"}><PanelLeft className="h-4 w-4"/></button>
          <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">{openFiles.map((file) => <div key={file} className={`group flex max-w-48 shrink-0 items-center gap-1.5 border-r border-border px-2 text-[11px] ${activeFile === file ? "border-t-2 border-t-primary bg-background text-foreground" : "text-muted-foreground"}`}><button type="button" onClick={() => setActiveFile(file)} title={file} className="flex min-w-0 items-center gap-1.5">{fileIcon(file)}<span className="truncate">{file.split("/").pop()}</span>{isModified(file) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-downloading" aria-label="Unsaved changes"/>}</button><button type="button" onClick={() => { const next = openFiles.filter((f) => f !== file); setOpenFiles(next); if (activeFile === file) setActiveFile(next.at(-1) || ""); }} aria-label={`Close ${file}`} className="rounded p-0.5 opacity-50 hover:bg-surface-hover hover:opacity-100"><X className="h-3 w-3"/></button></div>)}</div>
          {narrow && <button onClick={onShowChat} title="Return to chat" className="mx-1 my-0.5 rounded px-2 text-[10px] text-muted-foreground hover:bg-surface-hover">Chat</button>}
        </div>
        <div className="flex h-6 shrink-0 items-center gap-1 border-b border-border/70 bg-background px-3 text-[10px] text-muted-foreground">{activeFile ? <><Folder className="h-3 w-3 shrink-0"/><span className="truncate text-muted-foreground/70">AI_Server_Studio</span>{activeFile.split("/").map((segment, index, parts) => <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1"><ChevronRight className="h-3 w-3 shrink-0 opacity-40"/><span className={index === parts.length - 1 ? "truncate font-medium text-foreground/80" : "truncate"}>{segment}</span></span>)}</> : <span className="text-muted-foreground/60">No file open</span>}</div>
        <div className="min-h-0 flex-1">{activeFile && <Editor height="100%" path={activeFile} language={activeFile.endsWith(".tsx") || activeFile.endsWith(".ts") ? "typescript" : activeFile.endsWith(".json") ? "json" : activeFile.endsWith(".css") ? "css" : "markdown"} value={files[activeFile] || ""} onChange={(value) => setFiles((prev) => ({ ...prev, [activeFile]: value || "" }))} theme={appTheme === "dark" ? "vs-dark" : "vs"} options={{ minimap: { enabled: true }, fontSize: 13, automaticLayout: true, lineNumbersMinChars: 3, padding: { top: 10 }, scrollBeyondLastLine: false, wordWrap: "on" }} />}</div>
        <div className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-card px-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-status-online"/>Ready</span><span className="truncate px-2">{activeFile}</span><span className="shrink-0">{activeFile.endsWith(".json") ? "JSON" : activeFile.endsWith(".css") ? "CSS" : activeFile.endsWith(".md") ? "Markdown" : "TypeScript"} · UTF-8 · Ctrl+S</span></div>
      </div>
    </div> : <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-stretch border-b border-border bg-card/30 px-1"><div className="flex shrink-0 items-center border-r border-border pr-1">{viewSwitcher}{fullViewButton}</div><div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto px-1">{browserTab.map((tab) => <div key={tab.id} className={`group flex h-full max-w-52 shrink-0 items-center gap-2 border-r border-border px-2 text-[10px] ${tab.id === activeBrowserTab ? "border-t-2 border-t-primary bg-background text-foreground" : "text-muted-foreground hover:bg-surface-hover"}`}><button type="button" onClick={() => { setActiveBrowserTab(tab.id); setAddress(tab.url); setUrl(tab.url); }} title={tab.title} className="flex min-w-0 items-center gap-1.5"><Globe className="h-3 w-3 shrink-0"/><span className="truncate">{tab.title}</span></button>{browserTab.length > 1 && <button type="button" onClick={() => { const next = browserTab.filter((t) => t.id !== tab.id); setBrowserTab(next); if (tab.id === activeBrowserTab) { setActiveBrowserTab(next[0].id); setAddress(next[0].url); setUrl(next[0].url); } }} aria-label={`Close ${tab.title}`} className="rounded p-0.5 opacity-50 hover:bg-surface-hover hover:opacity-100"><X className="h-3 w-3"/></button>}</div>)}</div><button type="button" onClick={() => { const id = Date.now(); setBrowserTab((tabs) => [...tabs, { id, url: "about:blank", title: "New tab" }]); setActiveBrowserTab(id); setAddress(""); setUrl("about:blank"); }} className="my-0.5 rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground" title="New tab"><Plus className="h-3.5 w-3.5"/></button>{narrow && <button onClick={onShowChat} title="Return to chat" className="mx-1 my-0.5 rounded px-2 text-[10px] text-muted-foreground hover:bg-surface-hover">Chat</button>}</div>
      <div className="relative flex h-10 shrink-0 items-center gap-1 border-b border-border px-2"><button onClick={() => engine.back()} className="rounded p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground" title="Back"><ArrowLeft className="h-3.5 w-3.5"/></button><button onClick={() => engine.forward()} className="rounded p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground" title="Forward"><ArrowRight className="h-3.5 w-3.5"/></button><button onClick={() => loading ? engine.stop() : engine.reload()} className="rounded p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground" title={loading ? "Stop" : "Reload"}>{loading ? <X className="h-3.5 w-3.5"/> : <RotateCw className="h-3.5 w-3.5"/>}</button><button onClick={() => navigate(homepage)} className="rounded p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground" title="Home"><Home className="h-3.5 w-3.5"/></button><form onSubmit={(e) => { e.preventDefault(); navigate(); }} className="flex min-w-0 flex-1 items-center rounded-md border border-border bg-card px-2.5"><span className="text-status-online text-[10px]">●</span><input id="workspace-address" value={address} onChange={(e) => setAddress(e.target.value)} className="h-7 min-w-0 flex-1 bg-transparent px-2 text-[11px] outline-none" placeholder="Search or enter address"/><span className="text-[9px] text-muted-foreground">HTTP</span></form><button onClick={() => setHistoryOpen(!historyOpen)} className="rounded p-1.5 text-muted-foreground hover:bg-surface-hover"><History className="h-3.5 w-3.5"/></button><button onClick={() => setHistory((h) => [...h, url])} className="rounded p-1.5 text-muted-foreground hover:bg-surface-hover" title="Bookmark"><span className="text-sm">☆</span></button><button onClick={() => setMenuOpen(!menuOpen)} className="rounded p-1.5 text-muted-foreground hover:bg-surface-hover"><MoreHorizontal className="h-3.5 w-3.5"/></button>{historyOpen && <div className="absolute right-12 top-9 z-30 w-64 rounded-lg border border-border bg-popover p-2 shadow-xl"><div className="mb-2 flex items-center justify-between text-xs font-medium"><span>Recent history</span><button onClick={() => setHistory([])} className="text-[10px] text-muted-foreground hover:text-foreground">Clear</button></div>{history.slice(-6).reverse().map((item, i) => <button key={`${item}-${i}`} onClick={() => { navigate(item); setHistoryOpen(false); }} className="block w-full truncate rounded px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground">{item}</button>)}</div>}{menuOpen && <div className="absolute right-2 top-9 z-30 w-48 rounded-lg border border-border bg-popover p-1 shadow-xl">{[["History", () => setBrowserPage("history")], ["Downloads", () => setBrowserPage("downloads")], ["Settings", () => setBrowserPage("settings")], ["Find in page", () => setFindOpen(true)], ["View page source", () => setShowSource(!showSource)], ["Developer tools", () => engine.devtools()], ["Zoom out", () => engine.zoom(-10)], ["Zoom in", () => engine.zoom(10)], ["Reset zoom", () => setZoom(100)]].map(([label, action]) => <button key={label as string} onClick={() => { (action as () => void)(); setMenuOpen(false); }} className="w-full rounded px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground">{label as string}</button>)}</div>}</div>
      <div className="relative min-h-0 flex-1 bg-card/30">{loading && <div className="absolute left-0 right-0 top-0 z-10 h-0.5 overflow-hidden bg-primary/15"><div className="h-full w-1/3 animate-pulse bg-primary"/></div>}{findOpen && <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border border-border bg-background p-1.5 shadow-lg"><input autoFocus value={findText} onChange={(e) => setFindText(e.target.value)} placeholder="Find in page" className="w-36 bg-transparent px-1 text-xs outline-none"/><button onClick={() => setFindOpen(false)}><X className="h-3.5 w-3.5 text-muted-foreground"/></button></div>}{browserPage === "web" ? useCef ? <div id="cef-browser-surface" className="h-full w-full bg-background"/> : url === "about:blank" ? <div className="flex h-full flex-col items-center justify-center gap-3 text-center"><Globe className="h-9 w-9 text-muted-foreground/40"/><p className="text-sm font-medium text-muted-foreground">New tab</p><button onClick={() => navigate("http://localhost:3000")} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-hover">Preview localhost</button></div> : <iframe key={url} title="Browser preview" src={url} onLoad={() => setLoading(false)} style={{ zoom: `${zoom}%` }} className="h-full w-full border-0 bg-background" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" /> : browserPage === "history" ? <div className="mx-auto max-w-2xl p-8"><h2 className="mb-4 text-lg font-semibold">History</h2><input placeholder="Search history" className="mb-4 w-full rounded-md border border-border bg-card px-3 py-2 text-xs"/>{history.slice().reverse().map((item, i) => <button key={i} onClick={() => navigate(item)} className="block w-full border-b border-border py-3 text-left text-xs text-muted-foreground hover:text-foreground">{item}</button>)}</div> : browserPage === "settings" ? <div className="mx-auto max-w-xl space-y-4 p-8"><h2 className="text-lg font-semibold">Browser settings</h2><label className="block text-xs text-muted-foreground">Homepage<input value={homepage} onChange={(e) => setHomepage(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground"/></label><label className="block text-xs text-muted-foreground">Default search engine<select className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-foreground"><option>Google</option><option>DuckDuckGo</option><option>Bing</option></select></label><button onClick={() => setHistory([])} className="rounded border border-border px-3 py-2 text-xs">Clear browsing data</button><p className="text-[11px] text-muted-foreground">Cookies and user agent are managed by the active browser engine.</p></div> : <div className="p-8"><h2 className="mb-4 text-lg font-semibold">Downloads</h2><div className="flex items-center gap-2 rounded border border-border p-3 text-xs text-muted-foreground"><ArrowDownToLine className="h-4 w-4"/>No downloads yet</div></div>}{showSource && <pre className="absolute inset-4 z-20 overflow-auto rounded-lg border border-border bg-background p-4 text-xs text-foreground">{`Source for ${url}\n\nEmbedded browser page source is supplied by the browser engine.`}<button onClick={() => setShowSource(false)} className="float-right text-muted-foreground">Close</button></pre>}</div>
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-card px-3 text-[10px] text-muted-foreground"><button onClick={() => { setBrowserPage("web"); navigate("http://localhost:3000"); }} className="flex items-center gap-1.5 hover:text-foreground"><Globe className="h-3 w-3"/>Preview localhost</button><span>{loading ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin"/>Loading…</span> : `${zoom}% · ${useCef ? "CEF" : "Web preview"}`}</span><button onClick={() => setBrowserPage("settings")} className="flex items-center gap-1 hover:text-foreground"><Settings2 className="h-3 w-3"/>Settings</button></div>
    </div>}
  </section>;
}
