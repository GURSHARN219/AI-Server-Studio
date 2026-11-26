import { motion, AnimatePresence } from "framer-motion";
import {
  X, Download, CheckCircle2, XCircle, Loader2, Pause,
  RotateCcw, Trash2, HardDrive, Zap,
} from "lucide-react";
import type { DownloadItem } from "@/hooks/useDownloadManager";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return "";
  return `${formatBytes(bps)}/s`;
}

function StatusIcon({ status }: { status: DownloadItem["status"] }) {
  switch (status) {
    case "downloading": return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />;
    case "queued":      return <Pause className="w-3.5 h-3.5 text-muted-foreground" />;
    case "done":        return <CheckCircle2 className="w-3.5 h-3.5 text-status-online" />;
    case "error":       return <XCircle className="w-3.5 h-3.5 text-destructive" />;
    case "cancelled":   return <XCircle className="w-3.5 h-3.5 text-muted-foreground" />;
    default:            return <Download className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

type Props = {
  downloads: DownloadItem[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onClearCompleted: () => void;
  onClose: () => void;
};

export default function DownloadManager({ downloads, onCancel, onRetry, onRemove, onClearCompleted, onClose }: Props) {
  const active = downloads.filter(d => d.status === "downloading" || d.status === "queued");
  const done   = downloads.filter(d => d.status === "done");
  const failed = downloads.filter(d => d.status === "error" || d.status === "cancelled");

  return (
    <div className="flex flex-col h-full max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Downloads</h2>
          {active.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              {active.length} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(done.length > 0 || failed.length > 0) && (
            <button
              onClick={onClearCompleted}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-surface-hover"
            >
              Clear finished
            </button>
          )}
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-2 min-h-0">
        {downloads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Download className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-foreground">No downloads</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Go to Discover and click "Get" on a model to start downloading.
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {downloads.map(item => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="border border-border rounded-lg p-3 bg-secondary/10 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <StatusIcon status={item.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-foreground truncate">{item.displayName}</p>
                    <p className="text-[9px] text-muted-foreground font-mono truncate">{item.filename}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(item.status === "downloading" || item.status === "queued") && (
                      <button
                        onClick={() => onCancel(item.id)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded"
                        title="Cancel"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {(item.status === "error" || item.status === "cancelled") && (
                      <button
                        onClick={() => onRetry(item.id)}
                        className="p-1 text-muted-foreground hover:text-primary transition-colors rounded"
                        title="Retry"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                    {(item.status === "done" || item.status === "error" || item.status === "cancelled") && (
                      <button
                        onClick={() => onRemove(item.id)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded"
                        title="Remove"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {(item.status === "downloading" || item.status === "queued" || item.status === "done") && (
                  <div className="space-y-1">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${item.status === "done" ? "bg-status-online" : "bg-primary"}`}
                        style={{ width: `${item.progress}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                      <span>
                        {item.totalBytes > 0
                          ? `${formatBytes(item.bytesReceived)} / ${formatBytes(item.totalBytes)}`
                          : formatBytes(item.bytesReceived)}
                      </span>
                      <div className="flex items-center gap-2">
                        {item.speedBps > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5" />
                            {formatSpeed(item.speedBps)}
                          </span>
                        )}
                        <span>{item.progress}%</span>
                      </div>
                    </div>
                  </div>
                )}

                {item.status === "error" && item.error && (
                  <p className="text-[10px] text-destructive bg-destructive/5 px-2 py-1 rounded border border-destructive/20">
                    {item.error}
                  </p>
                )}

                {item.status === "done" && item.finishedAt && (
                  <p className="text-[9px] text-status-online">
                    Completed {new Date(item.finishedAt).toLocaleTimeString()}
                  </p>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
