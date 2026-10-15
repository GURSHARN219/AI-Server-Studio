import React, { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Search, Plus, X, FileJson } from "lucide-react";
import type { ChatTab, Message } from "./types";
import { useSettingsStore } from "@/stores/settingsStore";

interface SessionsSidebarProps {
  isOpen: boolean;
  tabs: ChatTab[];
  filteredTabs: ChatTab[];
  activeTab: string;
  sessionSearch: string;
  onSessionSearchChange: (value: string) => void;
  onNewTab: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  messagesMap?: Record<string, Message[]>;
}

function SessionsSidebarInner({
  isOpen,
  tabs,
  filteredTabs,
  activeTab,
  sessionSearch,
  onSessionSearchChange,
  onNewTab,
  onSelectTab,
  onCloseTab,
  messagesMap = {},
}: SessionsSidebarProps) {
  const { chat: chatSettings } = useSettingsStore();
  const { appearance } = useSettingsStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = (tab: ChatTab) => {
    setRenamingId(tab.id);
    setRenameValue(tab.title);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const commitRename = (tabId: string, onRename: (id: string, title: string) => void) => {
    if (renameValue.trim()) onRename(tabId, renameValue.trim());
    setRenamingId(null);
  };

  // Token count for a tab (rough estimate: chars / 4)
  const getTokenCount = (tabId: string) => {
    const msgs = messagesMap[tabId] || [];
    const chars = msgs.reduce((s, m) => s + (m.content?.length || 0), 0);
    return Math.round(chars / 4);
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: isOpen ? 208 : 0, opacity: isOpen ? 1 : 0 }}
      transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
      className="shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar flex flex-col h-full"
      aria-hidden={!isOpen}
    >
      <div className="w-[208px] h-full flex flex-col min-h-0">
        <div className="p-2 shrink-0">
          <div className="flex items-center gap-1.5 mb-1.5 rounded-md bg-background/40 px-2 py-1 border border-border/50">
            <Search className="w-3 h-3 text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Search…"
              value={sessionSearch}
              onChange={(e) => onSessionSearchChange(e.target.value)}
              className="flex-1 min-w-0 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none py-0.5"
            />
          </div>
          <button
            type="button"
            onClick={onNewTab}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-primary/15 text-primary text-[11px] font-medium border border-primary/20 hover:bg-primary/20 transition-colors"
          >
            <Plus className="w-3 h-3" /> New chat
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto flex flex-col min-h-0 px-1.5 pb-2 ${appearance.showTabStripScrollbar ? "scrollbar-thin" : "scrollbar-none"}`}>
          {filteredTabs.map((tab) => {
            const tokenCount = chatSettings.showTokenCountInList ? getTokenCount(tab.id) : 0;
            return (
              <div
                key={tab.id}
                className={`flex items-center gap-1.5 px-2 py-1.5 mb-0.5 rounded-md cursor-pointer transition-colors text-[11px] ${
                  tab.id === activeTab
                    ? "bg-background/80 text-foreground font-medium"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                }`}
                onClick={() => onSelectTab(tab.id)}
                onDoubleClick={() => {
                  if (chatSettings.doubleClickRename && tab.type !== "json-editor") {
                    startRename(tab);
                  }
                }}
              >
                {tab.type === "json-editor" && (
                  <FileJson className="w-3 h-3 shrink-0 text-status-downloading" />
                )}
                {renamingId === tab.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => setRenamingId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(tab.id, () => {});
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-background border border-primary/40 rounded px-1 text-[11px] text-foreground focus:outline-none"
                    autoFocus
                  />
                ) : (
                  <span className="truncate flex-1">{tab.title}</span>
                )}
                {chatSettings.showTokenCountInList && tokenCount > 0 && renamingId !== tab.id && (
                  <span className="text-[9px] text-muted-foreground/60 shrink-0 font-mono">{tokenCount}t</span>
                )}
                {tabs.length > 1 && renamingId !== tab.id && (
                  <button
                    type="button"
                    onClick={(e) => onCloseTab(tab.id, e)}
                    className="shrink-0 opacity-60 hover:opacity-100 hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </motion.aside>
  );
}

const SessionsSidebar = React.memo(SessionsSidebarInner);
export default SessionsSidebar;
