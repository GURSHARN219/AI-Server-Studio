import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Code2,
  Download,
  ExternalLink,
  Globe,
  History,
  Home,
  Lock,
  MoreHorizontal,
  Plus,
  RotateCw,
  Search,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { browserEngine } from "@/components/browser/Browser";
import { useStudioStore } from "@/stores/studioStore";
import { useSettingsStore } from "@/stores/settingsStore";

interface BrowserViewProps {
  addressInputRef?: React.RefObject<HTMLInputElement>;
}

const SEARCH_URLS = {
  duckduckgo: "https://duckduckgo.com/?q=",
  google: "https://www.google.com/search?q=",
  kagi: "https://kagi.com/search?q=",
  brave: "https://search.brave.com/search?q=",
};

export const BrowserView: React.FC<BrowserViewProps> = ({ addressInputRef }) => {
  const navigate = useNavigate();
  const internalAddressRef = useRef<HTMLInputElement>(null);
  const inputRef = addressInputRef ?? internalAddressRef;
  const surfaceRef = useRef<HTMLDivElement>(null);

  const browserTabs = useStudioStore((s) => s.browserTabs);
  const activeBrowserTabId = useStudioStore((s) => s.activeBrowserTabId);
  const setActiveBrowserTab = useStudioStore((s) => s.setActiveBrowserTab);
  const createBrowserTab = useStudioStore((s) => s.createBrowserTab);
  const closeBrowserTab = useStudioStore((s) => s.closeBrowserTab);
  const updateBrowserTab = useStudioStore((s) => s.updateBrowserTab);

  const bookmarks = useStudioStore((s) => s.bookmarks);
  const addBookmark = useStudioStore((s) => s.addBookmark);
  const removeBookmark = useStudioStore((s) => s.removeBookmark);
  const history = useStudioStore((s) => s.history);
  const addHistoryEntry = useStudioStore((s) => s.addHistoryEntry);
  const clearHistory = useStudioStore((s) => s.clearHistory);
  const downloads = useStudioStore((s) => s.downloads);
  const clearDownloads = useStudioStore((s) => s.clearDownloads);
  const browserSettings = useSettingsStore((s) => s.browser);
  const openUrlInBrowser = useStudioStore((s) => s.openUrlInBrowser);

  const activeTab =
    browserTabs.find((t) => t.id === activeBrowserTabId) ?? browserTabs[0];

  const [addressDraft, setAddressDraft] = useState(activeTab?.url ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [subView, setSubView] = useState<"page" | "history" | "bookmarks" | "downloads" | "source">("page");
  const [historyQuery, setHistoryQuery] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [devToolsTab, setDevToolsTab] = useState<"console" | "elements" | "network">("console");
  const [pageSource, setPageSource] = useState("");

  useEffect(() => {
    setAddressDraft(activeTab?.url ?? "");
    setSubView("page");
  }, [activeTab?.id, activeTab?.url]);

  useEffect(() => {
    const unsub = browserEngine.subscribe({
      onStateChange: (tabId, patch) => {
        updateBrowserTab(tabId, patch);
      },
      onHistoryVisit: (title, url) => {
        addHistoryEntry(title, url);
      },
    });
    return unsub;
  }, [updateBrowserTab, addHistoryEntry]);

  useEffect(() => {
    if (!activeTab) return;
    browserEngine.mount(activeTab.id, surfaceRef.current);
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      browserEngine.resize(activeTab.id, {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeTab?.id]);

  const navigateToInput = (raw: string) => {
    if (!activeTab) return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    let url = trimmed;
    if (!trimmed.includes("://") && !trimmed.startsWith("about:")) {
      if (trimmed.includes(".") || trimmed.startsWith("localhost")) {
        url = trimmed.startsWith("localhost") ? `http://${trimmed}` : `https://${trimmed}`;
      } else {
        url = `${SEARCH_URLS[browserSettings.searchEngine]}${encodeURIComponent(trimmed)}`;
      }
    }
    setSubView("page");
    browserEngine.navigate(activeTab.id, url);
  };

  const isBookmarked = bookmarks.some((b) => b.url === activeTab?.url);
  const toggleBookmark = () => {
    if (!activeTab) return;
    const existing = bookmarks.find((b) => b.url === activeTab.url);
    if (existing) {
      removeBookmark(existing.id);
    } else {
      addBookmark(activeTab.title, activeTab.url);
    }
  };

  const handleOpenSource = async () => {
    if (!activeTab) return;
    const src = await browserEngine.viewSource(activeTab.id);
    setPageSource(src);
    setSubView("source");
    setMenuOpen(false);
  };

  const handleToggleDevTools = () => {
    if (!activeTab) return;
    if (devToolsOpen) {
      browserEngine.closeDevTools(activeTab.id);
      setDevToolsOpen(false);
    } else {
      browserEngine.openDevTools(activeTab.id);
      setDevToolsOpen(true);
    }
    setMenuOpen(false);
  };

  const isLocalPreview = activeTab?.url.startsWith("http://localhost:5173");
  const groupedHistory = (["Today", "Yesterday", "Earlier"] as const).map((group) => ({
    group,
    items: history.filter(
      (h) =>
        h.dayGroup === group &&
        (h.title.toLowerCase().includes(historyQuery.toLowerCase()) ||
          h.url.toLowerCase().includes(historyQuery.toLowerCase())),
    ),
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-card">
      {/* Browser Tabs Strip */}
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-edge-subtle bg-surface-subtle/40 px-2">
        {browserTabs.map((tab) => {
          const isActive = tab.id === activeTab?.id;
          return (
            <div
              key={tab.id}
              className={`group flex h-7 max-w-[190px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors ${
                isActive
                  ? "border-edge-subtle bg-surface-card font-medium text-ink-primary"
                  : "border-transparent text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveBrowserTab(tab.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <Globe className={`h-3 w-3 shrink-0 ${tab.isLoading ? "animate-spin text-accent-fg" : "text-ink-muted"}`} />
                <span className="truncate">{tab.title}</span>
              </button>
              <button
                type="button"
                onClick={() => closeBrowserTab(tab.id)}
                className="rounded p-0.5 text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                aria-label={`Close ${tab.title}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => createBrowserTab()}
          title="New browser tab (Ctrl+T)"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Browser Toolbar */}
      <div className="relative flex h-10 shrink-0 items-center gap-1.5 border-b border-edge-subtle px-2.5">
        <button
          type="button"
          onClick={() => activeTab && browserEngine.back(activeTab.id)}
          disabled={!activeTab?.canGoBack}
          title="Back"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover disabled:opacity-40"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => activeTab && browserEngine.forward(activeTab.id)}
          disabled={!activeTab?.canGoForward}
          title="Forward"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover disabled:opacity-40"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() =>
            activeTab &&
            (activeTab.isLoading
              ? browserEngine.stop(activeTab.id)
              : browserEngine.reload(activeTab.id))
          }
          title={activeTab?.isLoading ? "Stop" : "Reload"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover"
        >
          {activeTab?.isLoading ? <X className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => navigateToInput(browserSettings.homepage)}
          title="Home"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover"
        >
          <Home className="h-3.5 w-3.5" />
        </button>

        {/* Address Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigateToInput(addressDraft);
          }}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-edge-subtle bg-surface-subtle px-2.5 focus-within:border-accent-primary"
        >
          <Lock
            className={`h-3 w-3 shrink-0 ${
              activeTab?.isSecure ? "text-state-success" : "text-ink-muted"
            }`}
          />
          <input
            ref={inputRef}
            value={addressDraft}
            onChange={(e) => setAddressDraft(e.target.value)}
            placeholder="Enter URL or search..."
            className="min-w-0 flex-1 bg-transparent text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
          {activeTab && activeTab.zoom !== 100 && (
            <span className="rounded bg-surface-active px-1.5 py-0.5 font-mono text-[10px] text-ink-secondary">
              {activeTab.zoom}%
            </span>
          )}
        </form>

        <button
          type="button"
          onClick={toggleBookmark}
          title={isBookmarked ? "Remove bookmark" : "Bookmark this page"}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-hover ${
            isBookmarked ? "text-accent-fg" : "text-ink-muted"
          }`}
        >
          {isBookmarked ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
        </button>

        <button
          type="button"
          onClick={() => navigateToInput("http://localhost:5173")}
          className="hidden h-7 items-center gap-1 rounded-md border border-edge-subtle bg-surface-subtle px-2 text-[11px] font-medium text-ink-secondary hover:bg-surface-hover hover:text-ink-primary sm:inline-flex"
        >
          <Sparkles className="h-3 w-3 text-accent-fg" />
          Preview localhost
        </button>

        {/* ... Browser Menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            title="Browser menu"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-9 z-50 w-52 rounded-xl border border-edge-subtle bg-surface-elevated p-1 shadow-menu">
              <button
                type="button"
                onClick={() => {
                  setSubView("history");
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-ink-primary hover:bg-surface-hover"
              >
                <History className="h-3.5 w-3.5 text-ink-muted" />
                History
              </button>
              <button
                type="button"
                onClick={() => {
                  setSubView("bookmarks");
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-ink-primary hover:bg-surface-hover"
              >
                <Bookmark className="h-3.5 w-3.5 text-ink-muted" />
                Bookmarks
              </button>
              <button
                type="button"
                onClick={() => {
                  setSubView("downloads");
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-ink-primary hover:bg-surface-hover"
              >
                <Download className="h-3.5 w-3.5 text-ink-muted" />
                Downloads ({downloads.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setFindOpen(true);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-ink-primary hover:bg-surface-hover"
              >
                <Search className="h-3.5 w-3.5 text-ink-muted" />
                Find in page
              </button>
              <div className="my-1 border-t border-edge-subtle" />
              <div className="flex items-center justify-between px-2.5 py-1 text-xs text-ink-primary">
                <span>Zoom</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => activeTab && browserEngine.setZoom(activeTab.id, activeTab.zoom - 10)}
                    className="rounded p-1 hover:bg-surface-hover"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => activeTab && browserEngine.setZoom(activeTab.id, 100)}
                    className="font-mono text-[11px] tabular-nums hover:underline"
                  >
                    {activeTab?.zoom ?? 100}%
                  </button>
                  <button
                    type="button"
                    onClick={() => activeTab && browserEngine.setZoom(activeTab.id, activeTab.zoom + 10)}
                    className="rounded p-1 hover:bg-surface-hover"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {browserSettings.devToolsEnabled && (
                <button
                  type="button"
                  onClick={handleToggleDevTools}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-ink-primary hover:bg-surface-hover"
                >
                  <Terminal className="h-3.5 w-3.5 text-ink-muted" />
                  {devToolsOpen ? "Close DevTools" : "Developer Tools"}
                </button>
              )}
              <button
                type="button"
                onClick={handleOpenSource}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-ink-primary hover:bg-surface-hover"
              >
                <Code2 className="h-3.5 w-3.5 text-ink-muted" />
                View page source
              </button>
              <div className="my-1 border-t border-edge-subtle" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/settings?tab=browser");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-ink-primary hover:bg-surface-hover"
              >
                <Settings className="h-3.5 w-3.5 text-ink-muted" />
                Browser settings
              </button>
            </div>
          )}
        </div>

        {/* Loading Progress Bar */}
        {activeTab?.isLoading && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden bg-accent-soft">
            <div className="h-full w-1/2 animate-pulse bg-accent-primary" />
          </div>
        )}
      </div>

      {/* Bookmarks Bar */}
      {browserSettings.showBookmarksBar && bookmarks.length > 0 && (
        <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-edge-subtle bg-surface-subtle/30 px-2.5">
          {bookmarks.map((bm) => (
            <button
              key={bm.id}
              type="button"
              onClick={() => navigateToInput(bm.url)}
              className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
            >
              <Bookmark className="h-2.5 w-2.5 text-accent-fg" />
              <span>{bm.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* Find in Page Bar */}
      {findOpen && (
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-edge-subtle bg-surface-subtle px-3 text-xs">
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-ink-muted" />
            <input
              autoFocus
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder="Find in page..."
              className="w-56 bg-transparent text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none"
            />
            {findQuery && <span className="text-[11px] text-ink-muted">3 matches</span>}
          </div>
          <button
            type="button"
            onClick={() => {
              setFindOpen(false);
              setFindQuery("");
            }}
            className="rounded p-0.5 text-ink-muted hover:text-ink-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Surface */}
      <div ref={surfaceRef} className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-surface-canvas/50">
        {subView === "history" && (
          <div className="mx-auto w-full max-w-2xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-primary">Browsing History</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearHistory}
                  className="inline-flex items-center gap-1 rounded-md border border-edge-subtle bg-surface-card px-2.5 py-1 text-xs text-state-danger hover:bg-state-danger-soft"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear history
                </button>
                <button
                  type="button"
                  onClick={() => setSubView("page")}
                  className="rounded-md border border-edge-subtle bg-surface-card px-2.5 py-1 text-xs text-ink-primary hover:bg-surface-hover"
                >
                  Done
                </button>
              </div>
            </div>
            <input
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="Search history..."
              className="mb-4 h-8 w-full rounded-lg border border-edge-subtle bg-surface-card px-3 text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none"
            />
            <div className="space-y-4">
              {groupedHistory.map(
                ({ group, items }) =>
                  items.length > 0 && (
                    <div key={group} className="space-y-1">
                      <div className="text-[11px] font-medium text-ink-muted">{group}</div>
                      <div className="divide-y divide-edge-subtle rounded-lg border border-edge-subtle bg-surface-card">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between px-3 py-2 text-xs hover:bg-surface-hover"
                          >
                            <button
                              type="button"
                              onClick={() => navigateToInput(item.url)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="truncate font-medium text-ink-primary">{item.title}</div>
                              <div className="truncate text-[11px] text-ink-muted">{item.url}</div>
                            </button>
                            <div className="ml-3 flex shrink-0 items-center gap-2">
                              <span className="text-[11px] text-ink-muted">{item.visitedAt}</span>
                              <button
                                type="button"
                                onClick={() => openUrlInBrowser(item.url, true)}
                                title="Open in new tab"
                                className="rounded p-1 text-ink-muted hover:bg-surface-active hover:text-ink-primary"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
              )}
            </div>
          </div>
        )}

        {subView === "bookmarks" && (
          <div className="mx-auto w-full max-w-2xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-primary">Bookmarks Manager</h2>
              <button
                type="button"
                onClick={() => setSubView("page")}
                className="rounded-md border border-edge-subtle bg-surface-card px-2.5 py-1 text-xs text-ink-primary hover:bg-surface-hover"
              >
                Done
              </button>
            </div>
            <div className="divide-y divide-edge-subtle rounded-lg border border-edge-subtle bg-surface-card">
              {bookmarks.map((bm) => (
                <div key={bm.id} className="flex items-center justify-between px-3 py-2 text-xs">
                  <button
                    type="button"
                    onClick={() => navigateToInput(bm.url)}
                    className="min-w-0 flex-1 text-left hover:underline"
                  >
                    <div className="font-medium text-ink-primary">{bm.title}</div>
                    <div className="text-[11px] text-ink-muted">{bm.url}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeBookmark(bm.id)}
                    className="rounded p-1 text-ink-muted hover:text-state-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {subView === "downloads" && (
          <div className="mx-auto w-full max-w-2xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-primary">Downloads</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearDownloads}
                  className="rounded-md border border-edge-subtle bg-surface-card px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
                >
                  Clear list
                </button>
                <button
                  type="button"
                  onClick={() => setSubView("page")}
                  className="rounded-md border border-edge-subtle bg-surface-card px-2.5 py-1 text-xs text-ink-primary hover:bg-surface-hover"
                >
                  Done
                </button>
              </div>
            </div>
            <div className="divide-y divide-edge-subtle rounded-lg border border-edge-subtle bg-surface-card">
              {downloads.length === 0 ? (
                <div className="p-6 text-center text-xs text-ink-muted">No downloads yet</div>
              ) : (
                downloads.map((dl) => (
                  <div key={dl.id} className="flex items-center justify-between px-3 py-2.5 text-xs">
                    <div>
                      <div className="font-medium text-ink-primary">{dl.filename}</div>
                      <div className="text-[11px] text-ink-muted">
                        {dl.size} · {dl.status} · {dl.timestamp}
                      </div>
                    </div>
                    <span className="rounded bg-state-success-soft px-2 py-0.5 text-[10px] font-medium text-state-success">
                      {dl.progress}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {subView === "source" && (
          <div className="flex flex-1 flex-col bg-surface-code p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-xs font-medium text-ink-secondary">
                view-source:{activeTab?.url}
              </span>
              <button
                type="button"
                onClick={() => setSubView("page")}
                className="rounded-md border border-edge-subtle bg-surface-card px-2.5 py-1 text-xs text-ink-primary hover:bg-surface-hover"
              >
                Back to page
              </button>
            </div>
            <pre className="flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-card p-3 font-mono text-xs leading-relaxed text-ink-primary">
              {pageSource}
            </pre>
          </div>
        )}

        {subView === "page" && (
          <div
            style={{ zoom: `${activeTab?.zoom ?? 100}%` }}
            className="flex flex-1 flex-col"
          >
            {browserEngine.kind === "cef" ? (
              <div className="flex flex-1 items-center justify-center text-xs text-ink-muted">
                Native CEF Surface Active ({activeTab?.url})
              </div>
            ) : isLocalPreview ? (
              <div className="mx-auto w-full max-w-4xl p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h1 className="text-lg font-semibold text-ink-primary">AI Gateway Health</h1>
                    <p className="text-xs text-ink-muted">
                      Live render from <span className="font-mono">{activeTab?.url}</span> · Engine: {browserEngine.kind.toUpperCase()}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-state-success-soft px-2.5 py-1 text-xs font-medium text-state-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-state-success" />
                    200 OK · Streaming Ready
                  </span>
                </div>

                <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                  <article className="rounded-lg border border-edge-subtle bg-surface-card p-4">
                    <p className="text-xs text-ink-muted">Requests / min</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-ink-primary">14,820</p>
                    <p className="mt-1 text-xs text-state-success">+8.4% vs baseline</p>
                  </article>
                  <article className="rounded-lg border border-edge-subtle bg-surface-card p-4">
                    <p className="text-xs text-ink-muted">P95 First Token</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-ink-primary">38 ms</p>
                    <p className="mt-1 text-xs text-ink-secondary">Local Metal GPU</p>
                  </article>
                  <article className="rounded-lg border border-edge-subtle bg-surface-card p-4">
                    <p className="text-xs text-ink-muted">Active Workers</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-ink-primary">6 / 8</p>
                    <p className="mt-1 text-xs text-ink-secondary">Zero dropped frames</p>
                  </article>
                </section>

                <div className="mt-4 rounded-lg border border-edge-subtle bg-surface-card p-4">
                  <div className="mb-2 text-xs font-semibold text-ink-primary">Active Gateway Routes</div>
                  <div className="space-y-1.5 font-mono text-xs">
                    <div className="flex items-center justify-between rounded bg-surface-subtle px-2.5 py-1.5">
                      <span className="text-ink-primary">/v1/chat/completions</span>
                      <span className="text-state-success">stream: true · 30000ms</span>
                    </div>
                    <div className="flex items-center justify-between rounded bg-surface-subtle px-2.5 py-1.5">
                      <span className="text-ink-primary">/v1/embeddings</span>
                      <span className="text-ink-muted">stream: false · 10000ms</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <iframe
                title={activeTab?.title ?? "Browser"}
                src={activeTab?.url}
                className="h-full w-full flex-1 border-0 bg-surface-card"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            )}
          </div>
        )}
      </div>

      {/* Embedded DevTools Drawer */}
      {devToolsOpen && (
        <div className="flex h-44 shrink-0 flex-col border-t border-edge-subtle bg-surface-code">
          <div className="flex h-7 items-center justify-between border-b border-edge-subtle px-3 text-[11px]">
            <div className="flex items-center gap-3">
              {(["console", "elements", "network"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDevToolsTab(t)}
                  className={`capitalize ${
                    devToolsTab === t
                      ? "font-semibold text-accent-fg"
                      : "text-ink-muted hover:text-ink-primary"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleToggleDevTools}
              className="text-ink-muted hover:text-ink-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-2.5 font-mono text-[11px] text-ink-secondary">
            {devToolsTab === "console" && (
              <div className="space-y-1">
                <div className="text-state-info">[CEF] Mounted surface for {activeTab?.url}</div>
                <div className="text-state-success">[Gateway] SSE stream connected (38ms TTFB)</div>
              </div>
            )}
            {devToolsTab === "elements" && (
              <pre>{`<main class="mx-auto max-w-4xl p-6">\n  <h1>AI Gateway Health</h1>\n  <section aria-label="Gateway throughput metrics">...</section>\n</main>`}</pre>
            )}
            {devToolsTab === "network" && (
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>GET {activeTab?.url}</span>
                  <span className="text-state-success">200 OK · 14ms</span>
                </div>
                <div className="flex justify-between">
                  <span>POST /v1/chat/completions</span>
                  <span className="text-state-success">200 SSE · 38ms</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
