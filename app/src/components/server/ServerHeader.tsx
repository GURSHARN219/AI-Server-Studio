import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Copy, Check, X } from "lucide-react";

type Props = {
  isRunning: boolean;
  onToggle: () => void;
  serverUrl: string;
  serverPort: string;
  onPortChange: (p: string) => void;
};

export function ServerHeader({ isRunning, onToggle, serverUrl, serverPort, onPortChange }: Props) {
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(serverUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0 bg-secondary/30">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-border bg-secondary/80">
            <span className="text-[11px] text-foreground font-medium">Status:</span>
            <span className={`text-[11px] font-medium ${isRunning ? "text-status-online" : "text-destructive"}`}>
              {isRunning ? "Running" : "Stopped"}
            </span>
            <button
              onClick={onToggle}
              className={`w-8 h-4 rounded-full relative transition-colors ${isRunning ? "bg-primary" : "bg-muted"}`}
            >
              <motion.div
                className="w-3 h-3 rounded-full bg-primary-foreground absolute top-0.5"
                animate={{ left: isRunning ? 16 : 2 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            </button>
          </div>
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-[11px] font-medium transition-colors ${
              showSettings ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary/80 text-foreground hover:bg-surface-hover"
            }`}
          >
            <Settings className="w-3 h-3" />
            Settings
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-primary font-medium">Reachable at:</span>
          <code className="text-[11px] font-mono text-foreground bg-secondary px-2.5 py-0.5 rounded-lg border border-border">
            {serverUrl}
          </code>
          <button onClick={handleCopy} className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-surface-hover">
            {copied ? <Check className="w-3.5 h-3.5 text-status-online" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-border"
          >
            <div className="p-4 bg-secondary/20 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-foreground">Server Configuration</h3>
                <button onClick={() => setShowSettings(false)} className="p-1 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <SettingsInput label="Port" value={serverPort} onChange={onPortChange} />
                <SettingsInput label="Host" value="127.0.0.1" readOnly />
                <SettingsInput label="Max Log Entries" value="500" readOnly />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function SettingsInput({ label, value, onChange, readOnly }: {
  label: string; value: string; onChange?: (v: string) => void; readOnly?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1 block">{label}</label>
      <input
        type="text"
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        className={`w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/50 transition-colors ${
          readOnly ? "text-muted-foreground" : "text-foreground"
        }`}
      />
    </div>
  );
}
