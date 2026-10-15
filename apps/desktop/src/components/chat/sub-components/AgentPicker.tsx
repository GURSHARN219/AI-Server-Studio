import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { AgentMode } from "@/components/chat/types";
import { AGENT_MODES } from "@/components/chat/useChatLogic";

interface AgentPickerProps {
  selectedAgent: AgentMode;
  showAgentPicker: boolean;
  setSelectedAgent: (agent: AgentMode) => void;
  setShowAgentPicker: (show: boolean) => void;
}

export function AgentPicker({ selectedAgent, showAgentPicker, setSelectedAgent, setShowAgentPicker }: AgentPickerProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowAgentPicker(!showAgentPicker)}
        className="flex items-center gap-1 p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-background/50"
      >
        {selectedAgent.icon}
        <ChevronDown className="w-2.5 h-2.5 opacity-70" />
      </button>
      <AnimatePresence>
        {showAgentPicker && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowAgentPicker(false)} />
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute bottom-full left-0 mb-1 w-56 bg-popover border border-border rounded-lg shadow-xl z-50 overflow-hidden"
            >
              <div className="py-1">
                {AGENT_MODES.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => { setSelectedAgent(agent); setShowAgentPicker(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-hover transition-colors ${selectedAgent.id === agent.id ? "bg-surface-active" : ""}`}
                  >
                    <span className={selectedAgent.id === agent.id ? "text-primary" : "text-muted-foreground"}>{agent.icon}</span>
                    <div>
                      <p className="text-xs font-medium text-foreground">{agent.name}</p>
                      <p className="text-[10px] text-muted-foreground">{agent.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
