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

if (typeof window !== "undefined" && window.electron?.onEnginePort) {
  window.electron.onEnginePort((port: number) => { enginePort = port; });
}

export function setEnginePort(port: number): void {
  if (port > 0 && port < 65536) enginePort = port;
}

export function getEnginePort(): number { return enginePort; }

export function engineBase(): string {
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
}

export interface LoadModelOptions {
  n_ctx?: number;
  n_gpu_layers?: number;
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
    return { available: true, loaded: data.loaded, model: data.loaded ? (data.modelName || data.model || null) : null };
  } catch {
    return { available: false, loaded: false, model: null };
  }
}

// ── Model Management ──────────────────────────────────────────────────────────

export async function loadModel(
  modelPath: string,
  options: LoadModelOptions = {}
): Promise<{ ok: boolean; error?: string }> {
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
