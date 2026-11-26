import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, ChevronDown } from "lucide-react";
import {
  type EndpointDef,
  PUBLIC_ENDPOINTS,
} from "./types";

const METHOD_COLORS: Record<string, string> = {
  GET:    "bg-status-online/10 text-status-online",
  POST:   "bg-status-downloading/10 text-status-downloading",
  PUT:    "bg-primary/10 text-primary",
  DELETE: "bg-destructive/10 text-destructive",
  PATCH:  "bg-accent/30 text-accent-foreground",
};

type TestResult = { path: string; status: string; time: number };

type Props = {
  onTest: (method: string, path: string) => void;
  testResult: TestResult | null;
};

export function EndpointsPanel({ onTest, testResult }: Props) {
  const [open, setOpen] = useState(true);
  const allEndpoints = PUBLIC_ENDPOINTS;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-hover/50 transition-colors bg-secondary/20 border-b border-border/50"
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center">
            <Terminal className="w-3 h-3 text-primary" />
          </div>
          <span className="text-[11px] font-semibold text-foreground">API Endpoints</span>
          <span className="text-[9px] text-muted-foreground/70">OpenAI-compatible</span>
          <span className="text-[9px] font-mono bg-muted/50 px-1.5 py-0.5 rounded text-muted-foreground">{allEndpoints.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </motion.div>
        </div>
      </button>

      {/* Endpoint list — public + custom only */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="py-1">
              {allEndpoints.map((ep) => (
                <EndpointRow
                  key={`${ep.method}-${ep.path}`}
                  ep={ep}
                  onTest={onTest}
                />
              ))}
            </div>

            {testResult && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mx-3 mb-2 px-2.5 py-1.5 rounded text-[10px] font-mono border ${
                  testResult.status.startsWith("2")
                    ? "bg-status-online/5 border-status-online/20 text-status-online"
                    : "bg-destructive/5 border-destructive/20 text-destructive"
                }`}
              >
                <span className="font-semibold">{testResult.path}</span> → {testResult.status}{" "}
                <span className="text-muted-foreground">({testResult.time}ms)</span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EndpointRow({ ep, onTest, onRemove }: {
  ep: EndpointDef;
  onTest: (method: string, path: string) => void;
  onRemove?: (path: string) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-1 group hover:bg-surface-hover/40 transition-colors">
      <span className={`text-[9px] font-mono font-bold px-1 py-px rounded text-center min-w-[36px] ${METHOD_COLORS[ep.method] ?? "bg-muted text-foreground"}`}>
        {ep.method}
      </span>
      <span className="text-[11px] text-foreground font-mono flex-1">{ep.path}</span>
      <span className="text-[9px] text-muted-foreground/60 hidden group-hover:inline">{ep.description}</span>
      {ep.testable && (
        <button
          onClick={() => onTest(ep.method, ep.path)}
          className="text-[9px] px-1.5 py-px rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all opacity-0 group-hover:opacity-100"
        >
          Test
        </button>
      )}
    </div>
  );
}
