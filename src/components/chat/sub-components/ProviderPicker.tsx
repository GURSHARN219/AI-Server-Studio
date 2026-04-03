import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, HardDrive, Globe, Check } from "lucide-react";

interface ProviderOption {
  id: string;
  name: string;
  type: "local" | "api";
}

interface ProviderPickerProps {
  selectedProviderId: string;
  setSelectedProviderId: (id: string) => void;
  showProviderPicker: boolean;
  setShowProviderPicker: (show: boolean) => void;
  setShowModelPicker: (show: boolean) => void;
  providerOptions: ProviderOption[];
  selectedProviderOption: ProviderOption | undefined;
}

export function ProviderPicker({
  selectedProviderId, setSelectedProviderId,
  showProviderPicker, setShowProviderPicker, setShowModelPicker,
  providerOptions, selectedProviderOption,
}: ProviderPickerProps) {
  return (
    <div className="relative ml-0.5 border-l border-border/50 pl-1">
      <button
        type="button"
        onClick={() => { setShowProviderPicker(!showProviderPicker); setShowModelPicker(false); }}
        className="flex items-center gap-0.5 px-1 py-0.5 rounded-md hover:bg-background/50 transition-colors"
      >
        <span className={selectedProviderOption?.type === "local" ? "text-status-online" : "text-status-downloading"}>
          {selectedProviderOption?.type === "local" ? <HardDrive className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">{(selectedProviderOption?.name || "").slice(0, 6)}</span>
        <ChevronDown className="w-2.5 h-2.5 text-muted-foreground" />
      </button>
      <AnimatePresence>
        {showProviderPicker && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowProviderPicker(false)} />
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute bottom-full left-0 mb-1 w-44 bg-popover border border-border rounded-md shadow-lg z-50 overflow-hidden"
            >
              <div className="px-2 py-1 border-b border-border">
                <span className="text-[8px] text-muted-foreground uppercase tracking-wider font-semibold">Providers</span>
              </div>
              <div className="py-0.5 max-h-40 overflow-y-auto scrollbar-thin">
                {providerOptions.map((po) => (
                  <button
                    key={po.id}
                    onClick={() => { setSelectedProviderId(po.id); setShowProviderPicker(false); }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-hover transition-colors ${selectedProviderId === po.id ? "bg-surface-active" : ""}`}
                  >
                    <span className={po.type === "local" ? "text-status-online" : "text-status-downloading"}>
                      {po.type === "local" ? <HardDrive className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                    </span>
                    <span className="text-[11px] text-foreground truncate">{po.name}</span>
                    {selectedProviderId === po.id && <Check className="w-3 h-3 text-primary ml-auto shrink-0" />}
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
