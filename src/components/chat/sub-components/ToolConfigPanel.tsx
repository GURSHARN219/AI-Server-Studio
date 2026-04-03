import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileJson, X, Trash2, Plus } from "lucide-react";
import type { ToolConfig } from "@/lib/api";

interface ToolConfigPanelProps {
  showToolConfig: boolean;
  setShowToolConfig: (show: boolean) => void;
  toolConfigs: ToolConfig[];
  showAddTool: boolean;
  setShowAddTool: (show: boolean) => void;
  newToolName: string;
  setNewToolName: (v: string) => void;
  newToolSource: string;
  setNewToolSource: (v: string) => void;
  handleAddTool: () => void;
  removeToolConfig: (id: string) => void;
  toggleToolConfig: (id: string) => void;
  openJsonEditor: (configType: "mcp" | "tools") => void;
}

export function ToolConfigPanel({
  showToolConfig, setShowToolConfig, toolConfigs,
  showAddTool, setShowAddTool, newToolName, setNewToolName,
  newToolSource, setNewToolSource, handleAddTool,
  removeToolConfig, toggleToolConfig, openJsonEditor,
}: ToolConfigPanelProps) {
  return (
    <AnimatePresence>
      {showToolConfig && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          className="absolute bottom-full left-0 mb-2 w-80 bg-popover border border-border rounded-lg shadow-xl z-50 overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="text-xs font-semibold text-foreground">Tools</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { openJsonEditor("tools"); setShowToolConfig(false); }}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <FileJson className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setShowToolConfig(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="p-2 space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
            {toolConfigs.map((tool) => (
              <div key={tool.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-surface-hover transition-colors group">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">{tool.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{tool.source}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => removeToolConfig(tool.id)}
                    className="p-0.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => toggleToolConfig(tool.id)}
                    className={`w-7 h-4 rounded-full relative cursor-pointer transition-colors ${tool.enabled ? "bg-primary" : "bg-muted"}`}
                  >
                    <div className={`w-3 h-3 rounded-full bg-primary-foreground absolute top-0.5 transition-all ${tool.enabled ? "left-3.5" : "left-0.5"}`} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-border">
            {showAddTool ? (
              <div className="space-y-1.5">
                <input
                  value={newToolName}
                  onChange={(e) => setNewToolName(e.target.value)}
                  placeholder="Tool name"
                  className="w-full bg-background border border-border rounded px-2 py-1 text-[11px] text-foreground focus:outline-none"
                />
                <input
                  value={newToolSource}
                  onChange={(e) => setNewToolSource(e.target.value)}
                  placeholder="Source"
                  className="w-full bg-background border border-border rounded px-2 py-1 text-[11px] text-foreground font-mono focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <button onClick={handleAddTool} className="px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px]">Add</button>
                  <button onClick={() => setShowAddTool(false)} className="px-2 py-0.5 rounded bg-surface-hover text-foreground text-[10px]">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddTool(true)} className="flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80">
                <Plus className="w-3 h-3" /> Add tool
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
