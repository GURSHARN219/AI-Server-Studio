/**
 * Real model download manager.
 * Downloads GGUF files from HuggingFace using fetch + ReadableStream.
 * Saves to the configured models directory via the engine's /v1/download endpoint,
 * or falls back to tracking progress client-side and instructing the engine to load.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { getEnginePort } from "@/lib/localEngine";

export type DownloadStatus = "queued" | "downloading" | "paused" | "done" | "error" | "cancelled";

export type DownloadItem = {
  id: string;           // unique — modelId + variant
  modelId: string;      // HF repo id e.g. "bartowski/Qwen3-4B-GGUF"
  filename: string;     // e.g. "Qwen3-4B-Q4_K_M.gguf"
  displayName: string;  // human label
  url: string;          // direct HF download URL
  destDir: string;      // local destination directory
  status: DownloadStatus;
  progress: number;     // 0-100
  bytesReceived: number;
  totalBytes: number;
  speedBps: number;     // bytes/sec
  error?: string;
  startedAt?: number;
  finishedAt?: number;
};

const STORAGE_KEY = "ai-server:downloads";
const ENGINE_BASE = () => `http://localhost:${getEnginePort()}/v1`;

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

/** Build the direct HuggingFace download URL for a GGUF file */
export function hfDownloadUrl(repoId: string, filename: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${filename}`;
}

/** Fetch the file list for a HF repo and return GGUF siblings */
export async function fetchHfGgufFiles(repoId: string): Promise<{ filename: string; size: number }[]> {
  try {
    const res = await fetch(`https://huggingface.co/api/models/${repoId}?full=true`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const siblings: { rfilename: string; size?: number }[] = data.siblings ?? [];
    return siblings
      .filter(s => s.rfilename.endsWith(".gguf"))
      .map(s => ({ filename: s.rfilename, size: s.size ?? 0 }));
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
      // Try engine-side download first (POST /v1/tasks/download)
      const engineRes = await fetch(`${ENGINE_BASE()}/tasks/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, dest_dir: item.destDir, filename: item.filename }),
        signal: controller.signal,
      }).catch(() => null);

      if (engineRes?.ok) {
        // Engine handles it — poll for progress
        await pollEngineDownload(item.id, item.filename, controller.signal);
        return;
      }

      // Fallback: browser-side streaming download tracking
      const res = await fetch(item.url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const contentLength = Number(res.headers.get("content-length") ?? 0);
      updateItem(item.id, { totalBytes: contentLength });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      let received = 0;
      let lastSpeedCheck = Date.now();
      let lastBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;

        const now = Date.now();
        const elapsed = (now - lastSpeedCheck) / 1000;
        let speed = 0;
        if (elapsed >= 0.5) {
          speed = (received - lastBytes) / elapsed;
          lastSpeedCheck = now;
          lastBytes = received;
        }

        const progress = contentLength > 0 ? Math.round((received / contentLength) * 100) : 0;
        updateItem(item.id, { bytesReceived: received, progress, speedBps: speed });
      }

      // Download complete — notify engine to scan for new model
      await fetch(`${ENGINE_BASE()}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rescan: true }),
      }).catch(() => {});

      updateItem(item.id, {
        status: "done",
        progress: 100,
        bytesReceived: received,
        finishedAt: Date.now(),
        speedBps: 0,
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        updateItem(item.id, { status: "cancelled", speedBps: 0 });
      } else {
        updateItem(item.id, { status: "error", error: (e as Error).message, speedBps: 0 });
      }
    } finally {
      abortRefs.current.delete(item.id);
    }
  }, [updateItem]);

  async function pollEngineDownload(id: string, filename: string, signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const res = await fetch(`${ENGINE_BASE()}/tasks/${encodeURIComponent(filename)}`, { signal });
        if (res.ok) {
          const data = await res.json();
          updateItem(id, {
            progress: data.progress ?? 0,
            bytesReceived: data.bytes_received ?? 0,
            totalBytes: data.total_bytes ?? 0,
            speedBps: data.speed_bps ?? 0,
            status: data.done ? "done" : data.error ? "error" : "downloading",
            error: data.error,
            finishedAt: data.done ? Date.now() : undefined,
          });
          if (data.done || data.error) return;
        }
      } catch { /* ignore poll errors */ }
      await new Promise(r => setTimeout(r, 800));
    }
  }

  const cancelDownload = useCallback((id: string) => {
    abortRefs.current.get(id)?.abort();
    abortRefs.current.delete(id);
    updateItem(id, { status: "cancelled", speedBps: 0 });
  }, [updateItem]);

  const removeDownload = useCallback((id: string) => {
    abortRefs.current.get(id)?.abort();
    abortRefs.current.delete(id);
    setDownloads(prev => {
      const next = prev.filter(d => d.id !== id);
      persist(next);
      return next;
    });
  }, []);

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
