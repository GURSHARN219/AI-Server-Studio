/**
 * useLocalEngine
 * React hook that polls the local llama.cpp engine status
 * and exposes load/unload controls to the UI.
 */

import { useState, useEffect, useCallback } from "react";
import {
  getEngineStatus,
  loadModel,
  unloadModel,
  type EngineStatus,
  type LoadModelOptions,
} from "@/lib/localEngine";

interface UseLocalEngineReturn {
  status: EngineStatus;
  loading: boolean;
  error: string | null;
  load: (modelPath: string, options?: LoadModelOptions) => Promise<{ ok: boolean; error?: string }>;
  unload: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useLocalEngine(pollInterval = 5000): UseLocalEngineReturn {
  const [status, setStatus] = useState<EngineStatus>({
    available: false,
    loaded: false,
    model: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await getEngineStatus();
    setStatus(s);
  }, []);

  // Poll engine status
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollInterval);
    return () => clearInterval(id);
  }, [refresh, pollInterval]);

  const load = useCallback(async (modelPath: string, options?: LoadModelOptions): Promise<{ ok: boolean; error?: string }> => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadModel(modelPath, options);
      if (!result.ok) {
        setError(result.error ?? "Failed to load model");
        return result;
      }
      await refresh();
      return result;
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const unload = useCallback(async () => {
    await unloadModel();
    await refresh();
  }, [refresh]);

  return { status, loading, error, load, unload, refresh };
}
