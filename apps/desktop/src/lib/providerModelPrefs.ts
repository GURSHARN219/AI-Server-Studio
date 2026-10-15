import { getAccountSetting, setAccountSetting } from "@/stores/accountState";

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
    const parsed = getAccountSetting<Record<string, ProviderModelPrefs>>(STORAGE_KEY, {});
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
    setAccountSetting(STORAGE_KEY, prefs);
  } catch {
    // ignore storage errors
  }
}

export async function syncProviderModelPrefsFromBackend(): Promise<void> {
  // Hydrated with /settings/user before the account UI is shown.
}

export async function persistProviderModelPrefsToBackend(
  prefs: Record<string, ProviderModelPrefs>
): Promise<void> {
  saveProviderModelPrefs(prefs);
}

export function getProviderModelPref(providerId: string): ProviderModelPrefs | undefined {
  const pref = loadProviderModelPrefs()[providerId];
  return pref ? normalizePref(pref) : undefined;
}

export function setProviderModelPref(providerId: string, pref: ProviderModelPrefs): void {
  const current = loadProviderModelPrefs();
  current[providerId] = normalizePref(pref);
  saveProviderModelPrefs(current);

  // Persistence is queued with the account's captured token.
}
