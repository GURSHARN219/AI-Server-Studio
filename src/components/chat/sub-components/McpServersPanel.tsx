import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileJson, X, Trash2, Plus } from "lucide-react";
import type { McpServerConfig } from "@/lib/api";

interface McpServersPanelProps {
  showMcpServers: boolean;
  setShowMcpServers: (show: boolean) => void;
  mcpServers: McpServerConfig[];
  showAddMcp: boolean;
  setShowAddMcp: (show: boolean) => void;
  newMcpName: string;
  setNewMcpName: (v: string) => void;
  newMcpUrl: string;
  setNewMcpUrl: (v: string) => void;
  handleAddMcp: () => void;
  removeMcp: (id: string) => void;
  toggleMcpEnabled: (id: string) => void;
  openJsonEditor: (configType: "mcp" | "tools") => void;
}

export function McpServersPanel({
  showMcpServers, setShowMcpServers, mcpServers,
  showAddMcp, setShowAddMcp, newMcpName, setNewMcpName,
  newMcpUrl, setNewMcpUrl, handleAddMcp,
  removeMcp, toggleMcpEnabled, openJsonEditor,
}: McpServersPanelProps) {
  return (
    <AnimatePresence>
      {showMcpServers && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          className="absolute bottom-full left-0 mb-2 w-80 bg-popover border border-border rounded-lg shadow-xl z-50 overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="text-xs font-semibold text-foreground">MCP Servers</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { openJsonEditor("mcp"); setShowMcpServers(false); }}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <FileJson className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setShowMcpServers(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="p-2 space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
            {mcpServers.map((server) => (
              <div key={server.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-hover transition-colors group">
                <button
                  onClick={() => toggleMcpEnabled(server.id)}
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${server.enabled ? "bg-status-online" : "bg-muted-foreground"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">{server.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{server.url}</p>
                </div>
                <button
                  onClick={() => removeMcp(server.id)}
                  className="p-0.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-border">
            {showAddMcp ? (
              <div className="space-y-1.5">
                <input
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  placeholder="Server name"
                  className="w-full bg-background border border-border rounded px-2 py-1 text-[11px] text-foreground focus:outline-none"
                />
                <input
                  value={newMcpUrl}
                  onChange={(e) => setNewMcpUrl(e.target.value)}
                  placeholder="URL"
                  className="w-full bg-background border border-border rounded px-2 py-1 text-[11px] text-foreground font-mono focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <button onClick={handleAddMcp} className="px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px]">Add</button>
                  <button onClick={() => setShowAddMcp(false)} className="px-2 py-0.5 rounded bg-surface-hover text-foreground text-[10px]">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddMcp(true)} className="flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80">
                <Plus className="w-3 h-3" /> Add MCP server
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
