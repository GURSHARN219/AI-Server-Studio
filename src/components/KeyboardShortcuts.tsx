import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Command, X, Search, MessageSquare, Settings, FolderOpen, Terminal, ArrowRight } from "lucide-react";

const SHORTCUTS = [
  { keys: ["Ctrl", "K"], action: "Command palette", group: "General" },
  { keys: ["Ctrl", "N"], action: "New chat tab", group: "Chat" },
  { keys: ["Ctrl", "W"], action: "Close current tab", group: "Chat" },
  { keys: ["Ctrl", "Tab"], action: "Next tab", group: "Chat" },
  { keys: ["Ctrl", "Shift", "Tab"], action: "Previous tab", group: "Chat" },
  { keys: ["Enter"], action: "Send message", group: "Chat" },
  { keys: ["Shift", "Enter"], action: "New line", group: "Chat" },
  { keys: ["Ctrl", ","], action: "Open settings", group: "Navigation" },
  { keys: ["Ctrl", "1"], action: "Go to Chat", group: "Navigation" },
  { keys: ["Ctrl", "2"], action: "Go to Server", group: "Navigation" },
  { keys: ["Ctrl", "3"], action: "Go to Models", group: "Navigation" },
  { keys: ["Ctrl", "/"], action: "Toggle shortcuts", group: "General" },
  { keys: ["Escape"], action: "Close panel / dialog", group: "General" },
];

const COMMAND_ITEMS = [
  { icon: MessageSquare, label: "New Chat", shortcut: "Ctrl+N", action: "new-chat" },
  { icon: Settings, label: "Settings", shortcut: "Ctrl+,", action: "settings" },
  { icon: Terminal, label: "Server", shortcut: "Ctrl+2", action: "server" },
  { icon: FolderOpen, label: "Models", shortcut: "Ctrl+3", action: "models" },
  { icon: Search, label: "Search", shortcut: "", action: "search" },
];

interface KeyboardShortcutsProps {
  onAction: (action: string) => void;
}

export default function KeyboardShortcuts({ onAction }: KeyboardShortcutsProps) {
  const [showPalette, setShowPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState("");

  const filteredCommands = COMMAND_ITEMS.filter(item =>
    item.label.toLowerCase().includes(paletteSearch.toLowerCase())
  );

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === "k") {
      e.preventDefault();
      setShowPalette(prev => !prev);
      setShowShortcuts(false);
    }
    if (ctrl && e.key === "/") {
      e.preventDefault();
      setShowShortcuts(prev => !prev);
      setShowPalette(false);
    }
    if (ctrl && e.key === "n") {
      e.preventDefault();
      onAction("new-chat");
    }
    if (ctrl && e.key === ",") {
      e.preventDefault();
      onAction("settings");
    }
    if (ctrl && e.key === "1") {
      e.preventDefault();
      onAction("chat");
    }
    if (ctrl && e.key === "2") {
      e.preventDefault();
      onAction("server");
    }
    if (ctrl && e.key === "3") {
      e.preventDefault();
      onAction("models");
    }
    if (e.key === "Escape") {
      setShowPalette(false);
      setShowShortcuts(false);
    }
  }, [onAction]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const runCommand = (action: string) => {
    setShowPalette(false);
    onAction(action);
  };

  return (
    <>
      {/* Command Palette */}
      <AnimatePresence>
        {showPalette && (
          <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-background/60 backdrop-blur-sm"
              onClick={() => setShowPalette(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              className="relative w-[420px] bg-popover border border-border rounded-xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  autoFocus
                  value={paletteSearch}
                  onChange={(e) => setPaletteSearch(e.target.value)}
                  placeholder="Type a command..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-surface-hover text-muted-foreground font-mono">ESC</kbd>
              </div>
              <div className="py-1 max-h-64 overflow-y-auto">
                {filteredCommands.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No results found</p>
                ) : (
                  filteredCommands.map((item) => (
                    <button
                      key={item.action}
                      onClick={() => runCommand(item.action)}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-hover transition-colors"
                    >
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs text-foreground flex-1">{item.label}</span>
                      {item.shortcut && (
                        <span className="text-[10px] text-muted-foreground font-mono">{item.shortcut}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
              <div className="px-3 py-2 border-t border-border flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" /> to select
                </span>
                <span className="text-[10px] text-muted-foreground">
                  <kbd className="px-1 py-0.5 rounded bg-surface-hover font-mono text-[9px]">Ctrl+/</kbd> shortcuts
                </span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Shortcuts Overlay */}
      <AnimatePresence>
        {showShortcuts && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-background/60 backdrop-blur-sm"
              onClick={() => setShowShortcuts(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-[480px] bg-popover border border-border rounded-xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Command className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold text-foreground">Keyboard Shortcuts</span>
                </div>
                <button onClick={() => setShowShortcuts(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-4 max-h-[60vh] overflow-y-auto scrollbar-thin space-y-4">
                {["General", "Chat", "Navigation"].map(group => {
                  const items = SHORTCUTS.filter(s => s.group === group);
                  return (
                    <div key={group}>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">{group}</p>
                      <div className="space-y-1">
                        {items.map((shortcut, i) => (
                          <div key={i} className="flex items-center justify-between py-1.5">
                            <span className="text-xs text-foreground">{shortcut.action}</span>
                            <div className="flex items-center gap-1">
                              {shortcut.keys.map((key, ki) => (
                                <kbd key={ki} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover text-muted-foreground font-mono border border-border min-w-[24px] text-center">
                                  {key}
                                </kbd>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
