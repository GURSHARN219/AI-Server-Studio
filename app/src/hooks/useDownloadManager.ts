/**
 * Real model download manager.
 * Downloads GGUF files from HuggingFace using fetch + ReadableStream.
 * Saves to the configured models directory via the engine's /v1/download endpoint,
 * or falls back to tracking progress client-side and instructing the engine to load.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { engineBase } from "@/lib/localEngine";

export type DownloadStatus = "queued" | "downloading" | "done" | "error" | "cancelled";

export type DownloadItem = {
  id: string;           // unique — modelId + variant
  modelId: string;      // HF repo id e.g. "bartowski/Qwen3-4B-GGUF"
  filename: string;     // e.g. "Qwen3-4B-Q4_K_M.gguf"
  displayName: string;  // human label
  url: string;          // direct HF download URL
  destDir: string;      // retained for display compatibility; backend owns the destination
  expectedSha256: string;
  backendTaskId?: string;
  status: DownloadStatus;
  progress: number;     // 0-100
  bytesReceived: number;
  totalBytes: number;
  speedBps: number;     // bytes/sec
  error?: string;
  startedAt?: number;
  finishedAt?: number;
};

type BackendTask = {
  id: string;
  url?: string;
  filename?: string;
  expected_sha256?: string;
  progress?: number;
  bytes_received?: number;
  total_bytes?: number;
  status?: string;
  error?: string;
};

const STORAGE_KEY = "ai-server:downloads";
const ENGINE_BASE = engineBase;

function loadPersistedDownloads(): DownloadItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const items: DownloadItem[] = JSON.parse(raw);
    // Reset in-progress items to error on reload (they were interrupted)
    return items.map(d =>
      d.status === "downloading" || d.status === "queued"
        ? { ...d, status: "error", error: "Interrupted by app restart" }
        : d
    );
  } catch { return []; }
}

function persist(items: DownloadItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* ignore */ }
}

function frontendStatus(status: string | undefined): DownloadStatus {
  switch (status) {
    case "completed": return "done";
    case "cancelled": return "cancelled";
    case "failed":
    case "interrupted": return "error";
    case "queued": return "queued";
    default: return "downloading";
  }
}

/** Build the direct HuggingFace download URL for a GGUF file */
export function hfDownloadUrl(repoId: string, filename: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${filename}`;
}

/** Fetch the file list for a HF repo and return GGUF siblings */
export async function fetchHfGgufFiles(repoId: string): Promise<{ filename: string; size: number; sha256?: string }[]> {
  try {
    const res = await fetch(`https://huggingface.co/api/models/${repoId}?full=true`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const siblings: { rfilename: string; size?: number; lfs?: { oid?: string; size?: number }; sha256?: string }[] = data.siblings ?? [];
    return siblings
      .filter(s => s.rfilename.endsWith(".gguf"))
      .map(s => {
        const oid = s.sha256 ?? s.lfs?.oid?.replace(/^sha256:/i, "");
        return {
          filename: s.rfilename,
          size: s.size ?? s.lfs?.size ?? 0,
          sha256: oid && /^[a-f0-9]{64}$/i.test(oid) ? oid.toLowerCase() : undefined,
        };
      });
  } catch { return []; }
}

export function useDownloadManager() {
  const [downloads, setDownloads] = useState<DownloadItem[]>(loadPersistedDownloads);
  const abortRefs = useRef<Map<string, AbortController>>(new Map());

  // Persist on every change
  useEffect(() => { persist(downloads); }, [downloads]);

  const updateItem = useCallback((id: string, patch: Partial<DownloadItem>) => {
    setDownloads(prev => {
      const next = prev.map(d => d.id === id ? { ...d, ...patch } : d);
      persist(next);
      return next;
    });
  }, []);

  // Backend task state is authoritative after a renderer restart. Persisted
  // local entries are only display metadata and are reconciled against the
  // durable task inventory here.
  useEffect(() => {
    let cancelled = false;
    void fetch(`${ENGINE_BASE()}/tasks`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Task inventory failed (${res.status})`);
        return await res.json() as { data?: BackendTask[] };
      })
      .then((body) => {
        if (cancelled) return;
        const tasks = body.data ?? [];
        setDownloads(prev => {
          const matched = new Set<string>();
          const next = prev.map(item => {
            const task = tasks.find(candidate => candidate.id === item.backendTaskId || (
              candidate.filename === item.filename && candidate.expected_sha256 === item.expectedSha256
            ));
            if (!task) {
              return item.status === "queued" || item.status === "downloading"
                ? { ...item, status: "error" as const, error: "Backend task is no longer available" }
                : item;
            }
            matched.add(task.id);
            const status = frontendStatus(task.status);
            return {
              ...item,
              backendTaskId: task.id,
              status,
              progress: task.progress != null ? Math.round(task.progress * 100) : item.progress,
              bytesReceived: task.bytes_received ?? item.bytesReceived,
              totalBytes: task.total_bytes ?? item.totalBytes,
              error: task.error,
              finishedAt: status === "done" || status === "error" || status === "cancelled" ? item.finishedAt ?? Date.now() : undefined,
            };
          });
          for (const task of tasks) {
            if (matched.has(task.id) || !task.filename || !task.expected_sha256) continue;
            const status = frontendStatus(task.status);
            next.push({
              id: `backend:${task.id}`,
              modelId: "",
              filename: task.filename,
              displayName: task.filename,
              url: task.url ?? "",
              destDir: "",
              expectedSha256: task.expected_sha256,
              backendTaskId: task.id,
              status,
              progress: task.progress != null ? Math.round(task.progress * 100) : 0,
              bytesReceived: task.bytes_received ?? 0,
              totalBytes: task.total_bytes ?? 0,
              speedBps: 0,
              error: task.error,
              finishedAt: status === "done" || status === "error" || status === "cancelled" ? Date.now() : undefined,
            });
          }
          persist(next);
          return next;
        });
      })
      .catch(() => {
        // The engine may be offline during renderer startup. Do not convert
        // persisted terminal history into a false success or hide it.
      });
    return () => { cancelled = true; };
  }, []);

  const pollEngineDownload = useCallback(async (id: string, taskId: string, signal: AbortSignal) => {
    while (!signal.aborted) {
      try {
        const res = await fetch(`${ENGINE_BASE()}/tasks/${encodeURIComponent(taskId)}`, { signal });
        if (res.ok) {
          const data = await res.json();
          const terminal = data.status === "completed" || data.status === "failed" || data.status === "cancelled" || data.status === "interrupted";
          const status: DownloadStatus = data.status === "completed"
            ? "done"
            : data.status === "cancelled"
              ? "cancelled"
              : terminal
                ? "error"
                : data.status === "queued"
                  ? "queued"
                  : "downloading";
          updateItem(id, {
            progress: Math.round((data.progress ?? 0) * 100),
            bytesReceived: data.bytes_received ?? 0,
            totalBytes: data.total_bytes ?? 0,
            speedBps: data.speed_bps ?? 0,
            status,
            error: data.error,
            finishedAt: terminal ? Date.now() : undefined,
          });
          if (terminal) return;
        }
      } catch { /* ignore poll errors */ }
      await new Promise(r => setTimeout(r, 800));
    }
  }, [updateItem]);

  const startDownload = useCallback(async (item: Omit<DownloadItem, "status" | "progress" | "bytesReceived" | "totalBytes" | "speedBps">) => {
    // Deduplicate
    setDownloads(prev => {
      if (prev.find(d => d.id === item.id && (d.status === "downloading" || d.status === "done"))) return prev;
      const existing = prev.find(d => d.id === item.id);
      const newItem: DownloadItem = {
        ...item,
        status: "queued",
        progress: 0,
        bytesReceived: 0,
        totalBytes: 0,
        speedBps: 0,
        startedAt: Date.now(),
      };
      const next = existing ? prev.map(d => d.id === item.id ? newItem : d) : [...prev, newItem];
      persist(next);
      return next;
    });

    const controller = new AbortController();
    abortRefs.current.set(item.id, controller);

    updateItem(item.id, { status: "downloading" });

    try {
      // The backend owns the transfer and the final filesystem write. There is
      // deliberately no browser-side fallback: a browser stream cannot prove
      // that the configured model directory contains the verified artifact.
      const engineRes = await fetch(`${ENGINE_BASE()}/tasks/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, filename: item.filename, expected_sha256: item.expectedSha256 }),
        signal: controller.signal,
      });
      const task = await engineRes.json().catch(() => ({})) as { task_id?: string; error?: string | { message?: string } };
      if (!engineRes.ok || !task.task_id) {
        const message = typeof task.error === "string" ? task.error : task.error?.message;
        throw new Error(message || `Download request failed (${engineRes.status})`);
      }
      updateItem(item.id, { backendTaskId: task.task_id });
      await pollEngineDownload(item.id, task.task_id, controller.signal);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        updateItem(item.id, { status: "cancelled", speedBps: 0 });
      } else {
        updateItem(item.id, { status: "error", error: (e as Error).message, speedBps: 0 });
      }
    } finally {
      abortRefs.current.delete(item.id);
    }
  }, [pollEngineDownload, updateItem]);

  const cancelDownload = useCallback(async (id: string) => {
    const item = downloads.find(d => d.id === id);
    abortRefs.current.get(id)?.abort();
    abortRefs.current.delete(id);
    if (item?.backendTaskId) {
      await fetch(`${ENGINE_BASE()}/tasks/${encodeURIComponent(item.backendTaskId)}/cancel`, {
        method: "POST",
      }).catch(() => {});
    }
    updateItem(id, { status: "cancelled", speedBps: 0 });
  }, [downloads, updateItem]);

  const removeDownload = useCallback((id: string) => {
    void (async () => {
      const item = downloads.find(d => d.id === id);
      abortRefs.current.get(id)?.abort();
      abortRefs.current.delete(id);
      if (item?.backendTaskId && (item.status === "downloading" || item.status === "queued")) {
        await fetch(`${ENGINE_BASE()}/tasks/${encodeURIComponent(item.backendTaskId)}/cancel`, { method: "POST" }).catch(() => {});
      }
      setDownloads(prev => {
        const next = prev.filter(d => d.id !== id);
        persist(next);
        return next;
      });
    })();
  }, [downloads]);

  const retryDownload = useCallback((id: string) => {
    const item = downloads.find(d => d.id === id);
    if (!item) return;
    startDownload({
      id: item.id,
      modelId: item.modelId,
      filename: item.filename,
      displayName: item.displayName,
      url: item.url,
      destDir: item.destDir,
      expectedSha256: item.expectedSha256,
    });
  }, [downloads, startDownload]);

  const clearCompleted = useCallback(() => {
    setDownloads(prev => {
      const next = prev.filter(d => d.status !== "done" && d.status !== "cancelled");
      persist(next);
      return next;
    });
  }, []);

  const activeCount = downloads.filter(d => d.status === "downloading" || d.status === "queued").length;

  return {
    downloads,
    activeCount,
    startDownload,
    cancelDownload,
    removeDownload,
    retryDownload,
    clearCompleted,
  };
}
import { engineFetch as fetch } from "@/api/client";
