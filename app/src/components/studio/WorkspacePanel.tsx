import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Cpu,
  ExternalLink,
  FolderOpen,
  Globe,
  Maximize2,
  Minimize2,
  Wrench,
} from "lucide-react";
import { BrowserView } from "@/components/browser/BrowserView";
import { CodeWorkspace } from "@/components/codeeditor/CodeWorkspace";
import { MOCK_MODELS } from "@/data/mockWorkspace";
import { useStudioStore } from "@/stores/studioStore";

interface WorkspacePanelProps {
  browserAddressRef?: React.RefObject<HTMLInputElement>;
}

export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({ browserAddressRef }) => {
  const layoutMode = useStudioStore((s) => s.layoutMode);
  const setLayoutMode = useStudioStore((s) => s.setLayoutMode);
  const workspaceView = useStudioStore((s) => s.workspaceView);
  const setWorkspaceView = useStudioStore((s) => s.setWorkspaceView);
  const activeDestination = useStudioStore((s) => s.activeDestination);
  const setActiveDestination = useStudioStore((s) => s.setActiveDestination);

  const selectedModelId = useStudioStore((s) => s.selectedModelId);
  const setSelectedModelId = useStudioStore((s) => s.setSelectedModelId);
  const tools = useStudioStore((s) => s.tools);
  const toggleTool = useStudioStore((s) => s.toggleTool);
  const knowledge = useStudioStore((s) => s.knowledge);
  const toggleKnowledge = useStudioStore((s) => s.toggleKnowledge);

  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const openMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (openMenuRef.current && !openMenuRef.current.contains(e.target as Node)) {
        setOpenMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onOutside);
    return () => window.removeEventListener("mousedown", onOutside);
  }, []);

  const triggerFeedback = (msg: string) => {
    setFeedback(msg);
    setOpenMenuOpen(false);
    window.setTimeout(() => setFeedback(null), 2200);
  };

  const isSpecialDest =
    activeDestination === "models" ||
    activeDestination === "tools" ||
    activeDestination === "knowledge";

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-edge-subtle bg-surface-card">
      {/* Workspace Top Toolbar */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-edge-subtle px-2.5">
        {/* Left: Code / Browser Switcher */}
        <div className="flex items-center gap-1 rounded-lg border border-edge-subtle bg-surface-subtle p-0.5">
          <button
            type="button"
            onClick={() => {
              setActiveDestination("files");
              setWorkspaceView("code");
            }}
            className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors ${
              !isSpecialDest && workspaceView === "code"
                ? "bg-surface-card text-ink-primary shadow-sm"
                : "text-ink-secondary hover:text-ink-primary"
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>Code</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveDestination("browser");
              setWorkspaceView("browser");
            }}
            className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors ${
              !isSpecialDest && workspaceView === "browser"
                ? "bg-surface-card text-ink-primary shadow-sm"
                : "text-ink-secondary hover:text-ink-primary"
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>Browser</span>
          </button>
        </div>

        {/* Right: Full view + Open split button */}
        <div className="flex items-center gap-1.5">
          {feedback && (
            <span className="hidden rounded-md bg-state-info-soft px-2 py-1 text-[11px] text-state-info sm:inline">
              {feedback}
            </span>
          )}

          <button
            type="button"
            onClick={() => setLayoutMode(layoutMode === "full" ? "split" : "full")}
            title="Toggle Full view (Ctrl+Shift+F)"
            className="inline-flex h-6 items-center gap-1.5 rounded-md border border-edge-subtle bg-surface-subtle px-2 text-[11px] font-medium text-ink-primary hover:bg-surface-hover"
          >
            {layoutMode === "full" ? (
              <>
                <Minimize2 className="h-3.5 w-3.5 text-ink-muted" />
                <span>Exit full view</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5 text-ink-muted" />
                <span>Full view</span>
              </>
            )}
          </button>

          <div ref={openMenuRef} className="relative flex items-center">
            <div className="inline-flex h-6 items-center overflow-hidden rounded-md border border-edge-subtle bg-surface-subtle">
              <button
                type="button"
                onClick={() => triggerFeedback("Opened workspace in VS Code")}
                className="inline-flex h-full items-center gap-1 px-2 text-[11px] font-medium text-ink-primary hover:bg-surface-hover"
              >
                <ExternalLink className="h-3 w-3 text-ink-muted" />
                <span>Open</span>
              </button>
              <button
                type="button"
                onClick={() => setOpenMenuOpen((v) => !v)}
                aria-label="Open options"
                className="inline-flex h-full items-center border-l border-edge-subtle px-1.5 text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            {openMenuOpen && (
              <div className="absolute right-0 top-9 z-40 w-48 rounded-xl border border-edge-subtle bg-surface-elevated p-1 shadow-menu">
                <button
                  type="button"
                  onClick={() => triggerFeedback("Opened in VS Code")}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-ink-primary hover:bg-surface-hover"
                >
                  <Code2 className="h-3.5 w-3.5 text-ink-muted" />
                  Open in VS Code
                </button>
                <button
                  type="button"
                  onClick={() => triggerFeedback("Revealed in File Explorer")}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-ink-primary hover:bg-surface-hover"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-ink-muted" />
                  Show in File Explorer
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Workspace Body */}
      {activeDestination === "models" ? (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-accent-fg" />
              <h2 className="text-sm font-semibold text-ink-primary">Model Registry</h2>
            </div>
            <div className="divide-y divide-edge-subtle rounded-xl border border-edge-subtle bg-surface-card">
              {MOCK_MODELS.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-4 py-3 text-xs">
                  <div>
                    <div className="font-semibold text-ink-primary">{m.name}</div>
                    <div className="text-[11px] text-ink-muted">
                      {m.provider} · {m.contextWindow} context · {m.speed}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedModelId(m.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      selectedModelId === m.id
                        ? "bg-accent-soft text-accent-fg"
                        : "border border-edge-subtle hover:bg-surface-hover"
                    }`}
                  >
                    {selectedModelId === m.id ? "Active" : "Select"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : activeDestination === "tools" ? (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-accent-fg" />
              <h2 className="text-sm font-semibold text-ink-primary">Workspace Tools</h2>
            </div>
            <div className="divide-y divide-edge-subtle rounded-xl border border-edge-subtle bg-surface-card">
              {tools.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-4 py-3 text-xs">
                  <div>
                    <div className="font-semibold text-ink-primary">{t.name}</div>
                    <div className="text-[11px] text-ink-muted">{t.description}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleTool(t.id)}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                      t.enabled
                        ? "bg-state-success-soft text-state-success"
                        : "border border-edge-subtle text-ink-muted"
                    }`}
                  >
                    {t.enabled && <Check className="h-3 w-3" />}
                    {t.enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : activeDestination === "knowledge" ? (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-accent-fg" />
              <h2 className="text-sm font-semibold text-ink-primary">Knowledge Base</h2>
            </div>
            <div className="divide-y divide-edge-subtle rounded-xl border border-edge-subtle bg-surface-card">
              {knowledge.map((k) => (
                <div key={k.id} className="flex items-center justify-between px-4 py-3 text-xs">
                  <div>
                    <div className="font-semibold text-ink-primary">{k.title}</div>
                    <div className="text-[11px] text-ink-muted">
                      {k.type.toUpperCase()} · {k.chunks} indexed chunks
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleKnowledge(k.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      k.enabled
                        ? "bg-accent-soft text-accent-fg"
                        : "border border-edge-subtle text-ink-muted"
                    }`}
                  >
                    {k.enabled ? "Attached" : "Attach"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : workspaceView === "code" ? (
        <CodeWorkspace />
      ) : (
        <BrowserView addressInputRef={browserAddressRef} />
      )}
    </section>
  );
};
