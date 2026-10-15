import { useState, useEffect } from "react";
import { Save, RotateCcw, Copy, Check, AlertTriangle } from "lucide-react";

interface JsonEditorTabProps {
  configType: "mcp" | "tools";
  initialJson: string;
  onSave: (json: string) => void;
}

export default function JsonEditorTab({ configType, initialJson, onSave }: JsonEditorTabProps) {
  const [content, setContent] = useState(initialJson);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setHasChanges(content !== initialJson);
  }, [content, initialJson]);

  const validate = (json: string): boolean => {
    try {
      const parsed = JSON.parse(json);
      if (configType === "mcp") {
        if (!Array.isArray(parsed)) {
          setError("Root must be an array of MCP server objects");
          return false;
        }
        for (const item of parsed) {
          if (!item.id || !item.name || !item.url) {
            setError("Each MCP server must have: id, name, url");
            return false;
          }
        }
      } else if (configType === "tools") {
        if (!Array.isArray(parsed)) {
          setError("Root must be an array of tool objects");
          return false;
        }
        for (const item of parsed) {
          if (!item.id || !item.name || !item.source) {
            setError("Each tool must have: id, name, source");
            return false;
          }
        }
      }
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
      return false;
    }
  };

  const handleSave = () => {
    if (validate(content)) {
      // Format nicely before saving
      const formatted = JSON.stringify(JSON.parse(content), null, 2);
      setContent(formatted);
      onSave(formatted);
      setSaved(true);
      setHasChanges(false);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(content);
      setContent(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
  };

  const handleReset = () => {
    setContent(initialJson);
    setError(null);
    setHasChanges(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
    // Handle Tab for indentation
    if (e.key === "Tab") {
      e.preventDefault();
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newContent = content.substring(0, start) + "  " + content.substring(end);
      setContent(newContent);
      // Restore cursor position
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      }, 0);
    }
  };

  const lineCount = content.split("\n").length;

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Toolbar */}
      <div className="h-9 border-b border-border flex items-center justify-between px-3 shrink-0 bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">
            {configType === "mcp" ? "mcp-servers.json" : "tools-config.json"}
          </span>
          {hasChanges && (
            <span className="w-2 h-2 rounded-full bg-status-downloading" title="Unsaved changes" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleFormat}
            className="px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground rounded hover:bg-surface-hover transition-colors"
          >
            Format
          </button>
          <button
            onClick={handleCopy}
            className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-surface-hover transition-colors"
            title="Copy"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleReset}
            className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-surface-hover transition-colors"
            title="Reset"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
              saved
                ? "bg-status-online/20 text-status-online"
                : hasChanges
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            }`}
          >
            {saved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
          <span className="text-[11px] text-destructive">{error}</span>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Line numbers */}
        <div className="w-12 bg-secondary border-r border-border overflow-hidden shrink-0 py-3 px-1">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="text-[10px] font-mono text-muted-foreground text-right pr-2 leading-5 select-none">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Text area */}
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            // Live validation
            try {
              JSON.parse(e.target.value);
              setError(null);
            } catch {
              // Don't show error while typing
            }
          }}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="flex-1 bg-background text-foreground font-mono text-xs leading-5 p-3 resize-none focus:outline-none scrollbar-thin overflow-auto"
        />
      </div>

      {/* Status bar */}
      <div className="h-6 border-t border-border bg-secondary flex items-center px-3 text-[10px] font-mono text-muted-foreground gap-4 shrink-0">
        <span>JSON</span>
        <span>{lineCount} lines</span>
        <span>{content.length} chars</span>
        <div className="flex-1" />
        <span className="text-[10px]">Ctrl+S to save</span>
      </div>
    </div>
  );
}
