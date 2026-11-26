import React, { useState } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import {
  Columns2,
  FileCode2,
  GitCompare,
  Map as MapIcon,
  PanelLeft,
  Terminal,
  X,
} from "lucide-react";
import { FileExplorer } from "@/components/codeeditor/FileExplorer";
import { TerminalDrawer } from "@/components/codeeditor/TerminalDrawer";
import { findFileByPath, useStudioStore } from "@/stores/studioStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAppTheme } from "@/hooks/useAppTheme";
import type { FileNode } from "@/types/studio";

function getMonacoLanguage(file: FileNode): string {
  const lang = file.language?.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase();
  const key = lang || ext || "";
  switch (key) {
    case "ts":
    case "tsx":
    case "typescript":
      return "typescript";
    case "js":
    case "jsx":
    case "javascript":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
      return "html";
    case "md":
    case "markdown":
      return "markdown";
    case "py":
    case "python":
      return "python";
    case "go":
      return "go";
    case "sh":
    case "bash":
    case "shell":
      return "shell";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
}

const EditorPane: React.FC<{
  file: FileNode | null;
  diffMode: boolean;
  minimapOpen: boolean;
  onCursorMove?: (line: number, col: number) => void;
}> = ({ file, diffMode, minimapOpen, onCursorMove }) => {
  const theme = useAppTheme();
  const editorSettings = useSettingsStore((s) => s.editor);
  const updateFileContent = useStudioStore((s) => s.updateFileContent);

  if (!file) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-ink-muted">
        Select a file from the explorer or press Ctrl+P to open
      </div>
    );
  }

  const monacoTheme = theme === "dark" ? "vs-dark" : "vs";
  const language = getMonacoLanguage(file);
  const showDiff = diffMode && file.previousContent !== undefined && file.content !== undefined;

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-surface-card">
      {showDiff ? (
        <DiffEditor
          height="100%"
          language={language}
          original={file.previousContent ?? ""}
          modified={file.content ?? ""}
          theme={monacoTheme}
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: minimapOpen },
            fontSize: editorSettings.fontSize,
            wordWrap: editorSettings.wordWrap ? "on" : "off",
            lineNumbers: editorSettings.lineNumbers ? "on" : "off",
            automaticLayout: true,
            scrollBeyondLastLine: false,
          }}
        />
      ) : (
        <Editor
          height="100%"
          path={file.path}
          language={language}
          value={file.content ?? ""}
          theme={monacoTheme}
          onChange={(value) => updateFileContent(file.path, value ?? "")}
          onMount={(editor) => {
            editor.onDidChangeCursorPosition((e) => {
              onCursorMove?.(e.position.lineNumber, e.position.column);
            });
          }}
          options={{
            minimap: { enabled: minimapOpen },
            fontSize: editorSettings.fontSize,
            tabSize: editorSettings.tabSize,
            wordWrap: editorSettings.wordWrap ? "on" : "off",
            lineNumbers: editorSettings.lineNumbers ? "on" : "off",
            automaticLayout: true,
            lineNumbersMinChars: 3,
            padding: { top: 10 },
            scrollBeyondLastLine: false,
          }}
        />
      )}
    </div>
  );
};

export const CodeWorkspace: React.FC = () => {
  const files = useStudioStore((s) => s.files);
  const openFilePaths = useStudioStore((s) => s.openFilePaths);
  const activeFilePath = useStudioStore((s) => s.activeFilePath);
  const splitFilePath = useStudioStore((s) => s.splitFilePath);
  const openFile = useStudioStore((s) => s.openFile);
  const closeFileTab = useStudioStore((s) => s.closeFileTab);
  const reorderFileTabs = useStudioStore((s) => s.reorderFileTabs);
  const splitViewOpen = useStudioStore((s) => s.splitViewOpen);
  const diffViewOpen = useStudioStore((s) => s.diffViewOpen);
  const minimapOpen = useStudioStore((s) => s.minimapOpen);
  const explorerOpen = useStudioStore((s) => s.explorerOpen);
  const terminalOpen = useStudioStore((s) => s.terminalOpen);
  const toggleSplitView = useStudioStore((s) => s.toggleSplitView);
  const toggleDiffView = useStudioStore((s) => s.toggleDiffView);
  const toggleMinimap = useStudioStore((s) => s.toggleMinimap);
  const toggleExplorer = useStudioStore((s) => s.toggleExplorer);
  const toggleTerminal = useStudioStore((s) => s.toggleTerminal);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const activeFile = findFileByPath(files, activeFilePath);
  const splitFile = splitFilePath ? findFileByPath(files, splitFilePath) : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Collapsible Explorer (drawer on narrow viewports) */}
        {explorerOpen && (
          <div className="absolute inset-y-0 left-0 z-20 flex shadow-menu md:static md:shadow-none">
            <FileExplorer />
          </div>
        )}

        {/* Editor Area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Tabs + Editor Toolbar */}
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-edge-subtle bg-surface-subtle/40 px-2">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              <button
                type="button"
                onClick={toggleExplorer}
                title="Toggle file explorer"
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ${
                  explorerOpen
                    ? "bg-surface-active text-ink-primary"
                    : "text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                }`}
              >
                <PanelLeft className="h-3.5 w-3.5" />
              </button>

              {openFilePaths.map((path, index) => {
                const node = findFileByPath(files, path);
                const name = node?.name ?? path.split("/").pop() ?? path;
                const isActive = path === activeFilePath;
                return (
                  <div
                    key={path}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null && dragIndex !== index) {
                        reorderFileTabs(dragIndex, index);
                      }
                      setDragIndex(null);
                    }}
                    className={`group flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors ${
                      isActive
                        ? "border-edge-subtle bg-surface-card font-medium text-ink-primary"
                        : "border-transparent text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openFile(path)}
                      className="flex items-center gap-1.5"
                    >
                      <FileCode2 className="h-3.5 w-3.5 text-ink-muted" />
                      <span>{name}</span>
                      {node?.changed && (
                        <span className="h-1.5 w-1.5 rounded-full bg-state-warning" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => closeFileTab(path)}
                      className="rounded p-0.5 text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                      aria-label={`Close ${name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Right Editor Controls */}
            <div className="ml-2 flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={toggleDiffView}
                title="Toggle diff view"
                className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium ${
                  diffViewOpen
                    ? "bg-accent-soft text-accent-fg"
                    : "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
                }`}
              >
                <GitCompare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Diff</span>
              </button>
              <button
                type="button"
                onClick={toggleMinimap}
                title="Toggle minimap"
                className={`inline-flex h-6 w-6 items-center justify-center rounded ${
                  minimapOpen
                    ? "bg-surface-active text-ink-primary"
                    : "text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                }`}
              >
                <MapIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={toggleSplitView}
                title="Toggle split editor"
                className={`inline-flex h-6 w-6 items-center justify-center rounded ${
                  splitViewOpen
                    ? "bg-surface-active text-ink-primary"
                    : "text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                }`}
              >
                <Columns2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={toggleTerminal}
                title="Toggle terminal drawer"
                className={`inline-flex h-6 w-6 items-center justify-center rounded ${
                  terminalOpen
                    ? "bg-surface-active text-ink-primary"
                    : "text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                }`}
              >
                <Terminal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Main + Optional Split Editor */}
          <div className="flex min-h-0 flex-1 divide-x divide-edge-subtle">
            <EditorPane
              file={activeFile}
              diffMode={diffViewOpen}
              minimapOpen={minimapOpen}
              onCursorMove={(line, col) => setCursor({ line, col })}
            />
            {splitViewOpen && (
              <EditorPane
                file={splitFile ?? activeFile}
                diffMode={false}
                minimapOpen={false}
              />
            )}
          </div>

          {/* Optional Bottom Terminal Drawer */}
          {terminalOpen && <TerminalDrawer />}

          {/* Slim Editor Status Bar */}
          <div className="flex h-6 shrink-0 items-center justify-between border-t border-edge-subtle bg-surface-subtle/50 px-3 text-[11px] text-ink-muted">
            <div className="flex items-center gap-2.5 truncate">
              <span className="inline-flex items-center gap-1 font-medium text-state-success">
                <span className="h-1.5 w-1.5 rounded-full bg-state-success" />
                Ready
              </span>
              <span className="truncate font-mono text-ink-secondary">
                {activeFile?.path ?? "No file open"}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3 font-mono tabular-nums">
              <span>{(activeFile?.language ?? "TXT").toUpperCase()}</span>
              <span>UTF-8</span>
              <span>
                Ln {cursor.line}, Col {cursor.col}
              </span>
              <span className="hidden sm:inline">Ctrl+P Quick Open</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
