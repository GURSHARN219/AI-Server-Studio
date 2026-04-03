import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Search, Pause, Play, Trash2, Copy, ChevronUp, ChevronDown, X } from "lucide-react";
import { type LogEntry, type LogLevel, levelColor, levelBg } from "./types";

type Props = {
  logs: LogEntry[];
  isPaused: boolean;
  onPauseToggle: () => void;
  onClear: () => void;
  logFilter: LogLevel;
  onFilterChange: (f: LogLevel) => void;
  logSearch: string;
  onSearchChange: (s: string) => void;
  showSearch: boolean;
  onToggleSearch: () => void;
  isRunning: boolean;
};

const LEVELS: LogLevel[] = ["ALL", "ERROR", "WARN", "INFO", "DEBUG"];

export function DevLogs({
  logs, isPaused, onPauseToggle, onClear,
  logFilter, onFilterChange,
  logSearch, onSearchChange,
  showSearch, onToggleSearch,
  isRunning,
}: Props) {
  const [open, setOpen] = [true, () => {}]; // always open by default; add state if needed
  const logsEndRef = useRef<HTMLDivElement>(null);

  const filtered = logs.filter(l => {
    if (logFilter !== "ALL" && l.level !== logFilter) return false;
    if (logSearch) {
      const q = logSearch.toLowerCase();
      return l.message.toLowerCase().includes(q) || l.source.toLowerCase().includes(q);
    }
    return true;
  });

  const counts = {
    INFO:  logs.filter(l => l.level === "INFO").length,
    DEBUG: logs.filter(l => l.level === "DEBUG").length,
    WARN:  logs.filter(l => l.level === "WARN").length,
    ERROR: logs.filter(l => l.level === "ERROR").length,
  };

  useEffect(() => {
    if (!isPaused) logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, isPaused]);

  const copyLogs = () => {
    const text = logs.map(l => `${l.timestamp} [${l.level}] [${l.source}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0 bg-secondary/20">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Developer Logs</span>
          {isRunning && !isPaused && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-status-online/10 border border-status-online/20">
              <span className="w-1.5 h-1.5 rounded-full bg-status-online animate-pulse" />
              <span className="text-[9px] text-status-online font-medium">Live</span>
            </span>
          )}
          <span className="text-[10px] text-muted-foreground font-mono">{filtered.length} entries</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 mr-1">
            {LEVELS.map(level => (
              <button
                key={level}
                onClick={() => onFilterChange(level)}
                className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${
                  logFilter === level
                    ? level === "ALL"
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : `${levelBg(level)} border`
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {level}
                {level !== "ALL" && <span className="ml-0.5 opacity-60">{counts[level as keyof typeof counts]}</span>}
              </button>
            ))}
          </div>
          <button
            onClick={onToggleSearch}
            className={`p-1 transition-colors rounded ${showSearch ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Search className="w-3.5 h-3.5" />
          </button>
          <button onClick={onPauseToggle} className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded" title={isPaused ? "Resume" : "Pause"}>
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onClear} className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded" title="Clear">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={copyLogs} className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded" title="Copy all">
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Search bar */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-border"
          >
            <div className="flex items-center gap-2 px-4 py-1.5 bg-secondary/30">
              <Search className="w-3 h-3 text-muted-foreground" />
              <input
                type="text"
                value={logSearch}
                onChange={e => onSearchChange(e.target.value)}
                placeholder="Filter logs..."
                className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                autoFocus
              />
              {logSearch && (
                <button onClick={() => onSearchChange("")} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Log table */}
      <div className="overflow-y-auto scrollbar-styled bg-background/30 font-mono text-[10px] leading-[20px] h-[260px]">
        <table className="w-full border-collapse">
          <AnimatePresence initial={false}>
            {filtered.map((log) => (
              <motion.tr
                key={log.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`hover:bg-surface-hover/30 border-b border-border/10 ${
                  log.level === "ERROR" ? "bg-destructive/5" : log.level === "WARN" ? "bg-status-downloading/5" : ""
                }`}
              >
                <td className="text-muted-foreground/40 px-2 py-[2px] whitespace-nowrap select-all w-[155px]">{log.timestamp}</td>
                <td className="px-1 py-[2px] w-[50px]">
                  <span className={`inline-block text-[9px] font-bold ${levelColor(log.level)}`}>{log.level}</span>
                </td>
                <td className="text-primary/50 px-1 py-[2px] whitespace-nowrap w-[120px]">{log.source}</td>
                <td className="text-foreground/80 px-1 py-[2px] whitespace-pre-wrap break-all">{log.message}</td>
              </motion.tr>
            ))}
          </AnimatePresence>
        </table>
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
