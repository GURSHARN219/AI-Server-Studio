import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Search, RotateCcw, HardDrive, Globe, Eye, Wrench, Brain, Code, MessageSquare, Settings, Square, Play, Loader2 } from "lucide-react";
import type { ModelDef, ModelSource } from "@/components/chat/types";

const sourceIcon = (source: ModelSource) => {
  switch (source) {
    case "local": return <HardDrive className="w-3 h-3" />;
    case "cloud": return <Globe className="w-3 h-3" />;
    case "api": return <Globe className="w-3 h-3" />;
  }
};

const sourceColor = (source: ModelSource) => {
  switch (source) {
    case "local": return "text-status-online";
    case "cloud": return "text-primary";
    case "api": return "text-status-downloading";
  }
};

const inferCapabilities = (model: ModelDef) => {
  const caps: { icon: React.ReactNode; label: string }[] = [];
  const n = model.name.toLowerCase();
  if (n.includes("vision") || n.includes("image") || n.includes("gemini") || n.includes("claude"))
    caps.push({ icon: <Eye className="w-2.5 h-2.5" />, label: "Vision" });
  if (model.supportsTools || n.includes("gpt") || n.includes("gemini") || n.includes("claude"))
    caps.push({ icon: <Wrench className="w-2.5 h-2.5" />, label: "Tools" });
  if (n.includes("thinking") || n.includes("reason") || n.includes("deepseek-r1"))
    caps.push({ icon: <Brain className="w-2.5 h-2.5" />, label: "Reasoning" });
  if (n.includes("code") || n.includes("coder"))
    caps.push({ icon: <Code className="w-2.5 h-2.5" />, label: "Code" });
  if (n.includes("chat") || n.includes("instruct"))
    caps.push({ icon: <MessageSquare className="w-2.5 h-2.5" />, label: "Chat" });
  return caps;
};

interface ModelPickerProps {
  selectedModel: ModelDef | undefined;
  showModelPicker: boolean;
  setShowModelPicker: (show: boolean) => void;
  modelSearch: string;
  setModelSearch: (s: string) => void;
  filteredModels: ModelDef[];
  isFetchingModels: boolean;
  fetchAllModels: () => void;
  handleModelChange: (model: ModelDef) => void;
  onOpenModelConfig?: () => void;
  onEjectModel?: () => void;
  onLoadModel?: (modelId: string, modelName: string, modelPath?: string) => void;
  runningLocalModel?: string | null;
  localModelLoading?: boolean;
}

export function ModelPicker({
  selectedModel, showModelPicker, setShowModelPicker,
  modelSearch, setModelSearch, filteredModels, isFetchingModels,
  fetchAllModels, handleModelChange, onOpenModelConfig, onEjectModel, onLoadModel, runningLocalModel, localModelLoading
}: ModelPickerProps) {

  const mBase = selectedModel && selectedModel.source === "local" 
    ? (selectedModel.name.split(/[\\/]/).pop() || selectedModel.name).replace(/\.(gguf|bin)$/i, "") 
    : null;
  const rBase = runningLocalModel
    ? (runningLocalModel.split(/[\\/]/).pop() || runningLocalModel).replace(/\.(gguf|bin)$/i, "") 
    : null;
  
  const isSelectedRunning = Boolean(mBase && rBase && (mBase === rBase || mBase.includes(rBase) || rBase.includes(mBase)));

  const handleSmartLoadUnload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedModel?.source !== "local") {
      onEjectModel?.();
      return;
    }
    if (isSelectedRunning) {
      onEjectModel?.();
    } else {
      onLoadModel?.(selectedModel.id.replace("local-", ""), selectedModel.name, selectedModel.path);
    }
  };

  return (
    <div className="relative flex items-center gap-1 ml-1 border-l border-border/50 pl-1">
      <button
        onClick={() => setShowModelPicker(!showModelPicker)}
        className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-surface-hover transition-colors"
      >
        <span className="text-[11px] text-foreground font-medium max-w-[120px] truncate font-mono">{selectedModel?.name ?? "No model"}</span>
        <ChevronDown className="w-2.5 h-2.5 text-muted-foreground" />
      </button>
      {selectedModel?.source === "local" && (
        <>
          <button type="button" onClick={() => onOpenModelConfig?.()} className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-background/50">
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={handleSmartLoadUnload} title={isSelectedRunning ? "Unload Model" : "Load Model"} className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-background/50" disabled={localModelLoading}>
            {localModelLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : !isSelectedRunning
                ? <Play className="w-3.5 h-3.5" />
                : <Square className="w-3.5 h-3.5" />
            }
          </button>
        </>
      )}
      <AnimatePresence>
        {showModelPicker && (
          <>
            <div className="absolute inset-0 z-40" onClick={() => setShowModelPicker(false)} />
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute bottom-full left-0 mb-1 w-[260px] bg-popover border border-border rounded-lg shadow-xl z-50 overflow-hidden"
            >
              <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border">
                <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="Search models..."
                  className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={(e) => { e.stopPropagation(); fetchAllModels(); }}
                  className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCcw className={`w-3 h-3 ${isFetchingModels ? "animate-spin" : ""}`} />
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto scrollbar-thin">
                {filteredModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => handleModelChange(model)}
                    className={`w-full px-2.5 py-1.5 flex items-start gap-2 text-left hover:bg-surface-hover transition-colors ${selectedModel?.id === model.id ? "bg-surface-active" : ""}`}
                  >
                    <span className={`shrink-0 ${sourceColor(model.source)}`}>{sourceIcon(model.source)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-foreground font-mono truncate">{model.name}</div>
                      {model.source === "api" && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {model.provider} | {model.providerType || "custom"} | {model.modelType || "chat"}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {inferCapabilities(model).map((c, i) => <span key={i} title={c.label} className="text-muted-foreground">{c.icon}</span>)}
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
