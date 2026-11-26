/**
 * Local Engine Client
 * Thin client for the Go llama.cpp engine running on http://localhost:{port}.
 * All endpoints match the Go server routes exactly.
 *
 * Chat completions for local models go through api.ts via getLocalProvider(),
 * which builds an ApiProvider pointing at this engine's base URL.
 * This file only handles engine management: status, model load/unload, config.
 */

import { engineFetch as fetch } from "@/api/client";
import { authHeaders } from "@/api/auth";
let enginePort = 1234;
let activeLoadRequest: Promise<{ ok: boolean; error?: string }> | null = null;

export function setEnginePort(port: number): void {
  if (port > 0 && port < 65536) enginePort = port;
}

export function getEnginePort(): number { return enginePort; }

export function engineBase(): string {
  // The browser distribution is served by the Go backend itself. Use the
  // current origin so an automatically selected or relocated port is shared
  // by the browser without an IPC bridge or a hard-coded port dependency.
  if (typeof window !== "undefined" && window.location.origin) {
    return `${window.location.origin}/v1`;
  }
  return `http://localhost:${enginePort}/v1`;
}

export function engineAuthHeaders(withJSON = false): Record<string, string> {
  return authHeaders(withJSON);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EngineStatus {
  available: boolean;
  loaded: boolean;
  model: string | null;
  runtimeMode?: "embedded" | "subprocess" | string;
  inferenceReady?: boolean;
  gpuBackend?: string;
  gpuLayers?: number;
}

export interface LoadModelOptions {
  n_ctx?: number;
  n_gpu_layers?: number;
}

export interface ModelAssessment {
  status: string;
  confidence: string;
  reason: string;
  architecture: string;
  quantization: string;
  estimatedRamBytes: number;
  estimatedVramBytes: number;
  availableRamBytes: number;
  availableVramBytes: number;
  recommendedContext: number;
  recommendedGpuLayers: number;
  backend: string;
}

// ── Status ────────────────────────────────────────────────────────────────────

export async function getEngineStatus(): Promise<EngineStatus> {
  try {
    const res = await fetch(`${engineBase()}/system/status`, {
      headers: engineAuthHeaders(),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { available: false, loaded: false, model: null };
    const data = await res.json();
    return {
      available: true,
      loaded: Boolean(data.loaded),
      model: data.loaded ? (data.modelName || data.model || null) : null,
      runtimeMode: data.runtimeMode,
      inferenceReady: Boolean(data.inferenceReady ?? data.loaded),
      gpuBackend: data.gpuBackend,
      gpuLayers: data.gpuLayers,
    };
  } catch {
    return { available: false, loaded: false, model: null };
  }
}

// ── Model Management ──────────────────────────────────────────────────────────

export async function loadModel(
  modelPath: string,
  options: LoadModelOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  if (activeLoadRequest) {
    return { ok: false, error: "A model load is already in progress" };
  }

  const request = (async () => {
    try {
      const res = await fetch(`${engineBase()}/models/load`, {
        method: "POST",
        headers: engineAuthHeaders(true),
        body: JSON.stringify({ model_path: modelPath, config: options }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error?.message ?? data.error ?? "Load failed" };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  })();
  activeLoadRequest = request;
  void request.finally(() => {
    if (activeLoadRequest === request) activeLoadRequest = null;
  });
  return request;
}

export async function assessModel(modelPath: string, nCtx?: number): Promise<ModelAssessment> {
  const res = await fetch(`${engineBase()}/models/assess`, {
    method: "POST",
    headers: engineAuthHeaders(true),
    body: JSON.stringify({ model_path: modelPath, n_ctx: nCtx }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? data.error ?? "Compatibility assessment failed");
  return data.assessment as ModelAssessment;
}

export async function unloadModel(): Promise<void> {
  try {
    await fetch(`${engineBase()}/models/unload`, {
      method: "POST",
      headers: engineAuthHeaders(),
    });
  } catch { /* engine offline */ }
}

export async function syncModelsDir(modelsDir: string): Promise<void> {
  try {
    await fetch(`${engineBase()}/config`, {
      method: "POST",
      headers: engineAuthHeaders(true),
      body: JSON.stringify({ models_dir: modelsDir }),
    });
  } catch { /* engine offline */ }
}
