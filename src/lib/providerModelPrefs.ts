import { getEnginePort } from "@/lib/localEngine";

export type ProviderModelPrefs = {
  allowedModels: string[];
  defaultModel?: string;
  selections?: ProviderModelSelection[];
};

export type ModelCapability = "chat" | "image" | "stt" | "tts" | "video";

export type ProviderModelSelection = {
  modelId: string;
  modelType: ModelCapability;
};

const STORAGE_KEY = "ai-server-provider-model-prefs";

function isBackendExpectedAtRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).electron);
}

const MODEL_TYPES: readonly ModelCapability[] = ["chat", "image", "stt", "tts", "video"];

function isModelType(value: string): value is ModelCapability {
  return (MODEL_TYPES as readonly string[]).includes(value);
}

function normalizePref(pref: ProviderModelPrefs | undefined): ProviderModelPrefs {
  const allowedModels = Array.from(new Set((pref?.allowedModels || []).map((m) => m.trim()).filter(Boolean)));

  const rawSelections = pref?.selections || [];
  const selections = rawSelections
    .map((s) => ({
      modelId: String(s?.modelId || "").trim(),
      modelType: isModelType(String(s?.modelType || "")) ? s.modelType : "chat",
    }))
    .filter((s) => Boolean(s.modelId));

  // Backward compatibility: old data had only allowedModels.
  const fallbackSelections = selections.length > 0
    ? selections
    : allowedModels.map((modelId) => ({ modelId, modelType: "chat" as const }));

  const mergedAllowedModels = Array.from(new Set([
    ...allowedModels,
    ...fallbackSelections.map((s) => s.modelId),
  ]));

  const defaultModel = pref?.defaultModel?.trim() || undefined;

  return {
    allowedModels: mergedAllowedModels,
    defaultModel,
    selections: fallbackSelections,
  };
}

export function loadProviderModelPrefs(): Record<string, ProviderModelPrefs> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ProviderModelPrefs>;
    if (!parsed || typeof parsed !== "object") return {};
    const normalized: Record<string, ProviderModelPrefs> = {};
    for (const [providerId, pref] of Object.entries(parsed)) {
      normalized[providerId] = normalizePref(pref);
    }
    return normalized;
  } catch {
    return {};
  }
}

export function saveProviderModelPrefs(prefs: Record<string, ProviderModelPrefs>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

export async function syncProviderModelPrefsFromBackend(): Promise<void> {
  if (!isBackendExpectedAtRuntime()) return;
  try {
    const localPrefs = loadProviderModelPrefs();
    const res = await fetch(`http://localhost:${getEnginePort()}/v1/settings/provider-model-prefs`, {
      method: "GET",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return;
    const data = await res.json();
    const backendPrefs = (data?.data || {}) as Record<string, ProviderModelPrefs>;

    // Merge: backend is the source of truth when it has entries,
    // but preserve any local-only providers and backfill backend on first run.
    const merged: Record<string, ProviderModelPrefs> = { ...backendPrefs };
    for (const [providerId, pref] of Object.entries(localPrefs)) {
      if (!merged[providerId]) merged[providerId] = pref;
    }

    const backendEmpty = Object.keys(backendPrefs).length === 0;
    const localNonEmpty = Object.keys(localPrefs).length > 0;

    if (backendEmpty && localNonEmpty) {
      // First-run backfill: keep localStorage as-is and persist to JSON.
      await persistProviderModelPrefsToBackend(localPrefs);
      return;
    }

    saveProviderModelPrefs(merged);

    // If we added any local-only entries, push the merged result to backend.
    if (Object.keys(merged).length !== Object.keys(backendPrefs).length) {
      await persistProviderModelPrefsToBackend(merged);
    }
  } catch {
    // ignore
  }
}

export async function persistProviderModelPrefsToBackend(
  prefs: Record<string, ProviderModelPrefs>
): Promise<void> {
  if (!isBackendExpectedAtRuntime()) return;
  try {
    await fetch(`http://localhost:${getEnginePort()}/v1/settings/provider-model-prefs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: prefs }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // ignore
  }
}

export function getProviderModelPref(providerId: string): ProviderModelPrefs | undefined {
  const pref = loadProviderModelPrefs()[providerId];
  return pref ? normalizePref(pref) : undefined;
}

export function setProviderModelPref(providerId: string, pref: ProviderModelPrefs): void {
  const current = loadProviderModelPrefs();
  current[providerId] = normalizePref(pref);
  saveProviderModelPrefs(current);

  // Fire-and-forget persistence to backend JSON in Electron.
  // Kept async to preserve the existing synchronous API.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  persistProviderModelPrefsToBackend(current);
}
