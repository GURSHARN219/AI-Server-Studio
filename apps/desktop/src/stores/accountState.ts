import { requestJson } from "@/api/client";
import { getAuthToken } from "@/api/auth";
import { hydrateChatState, useChatStore, type PersistedChatState } from "@/stores/chatStore";
import { hydrateSettings, useSettingsStore, type PersistedSettings } from "@/stores/settingsStore";

type UserSettings = Partial<PersistedSettings> & { preferences?: Record<string, unknown> };
type Pending = { owner: string; token: string; path: string; data: unknown; revision: number };
let account: { id: string; token: string } | null = null;
let generation = 0;
let hydrated = false;
let applying = false;
let settings: UserSettings = {};
const pending = new Map<string, Pending>();
const chains = new Map<string, Promise<void>>();
let timer: ReturnType<typeof setTimeout> | undefined;
const journalKey = (owner: string, path: string) => `ai-server-pending:${owner}:${path}`;

function notifyError(error: unknown) {
  window.dispatchEvent(new CustomEvent("account:sync-error", { detail: error instanceof Error ? error.message : "Could not save account state" }));
}

function schedule(path: string, data: unknown) {
  if (!account || !hydrated || applying) return;
  const key = `${account.id}:${path}`;
  pending.set(key, { owner: account.id, token: account.token, path, data: structuredClone(data), revision: (pending.get(key)?.revision || 0) + 1 });
  // An owner-scoped outbox survives a failed save or closing with a pending debounce.
  // Only UI data is journaled; session tokens and provider secrets are never written here.
  try { localStorage.setItem(journalKey(account.id, path), JSON.stringify(data)); } catch { /* server writes still proceed */ }
  clearTimeout(timer);
  timer = setTimeout(() => { void flushAccountState(); }, 250);
}

/** Every queued write captures the original owner/token and is ordered per resource. */
export async function flushAccountState(): Promise<void> {
  clearTimeout(timer);
  const writes = [...pending.entries()].map(([key, snapshot]) => {
    const write = (chains.get(key) || Promise.resolve()).then(async () => {
      if (pending.get(key) !== snapshot) return;
      try {
        await requestJson(snapshot.path, { method: "PUT", headers: { Authorization: `Bearer ${snapshot.token}` }, body: JSON.stringify({ data: snapshot.data }) });
        if (pending.get(key) === snapshot) {
          pending.delete(key);
          localStorage.removeItem(journalKey(snapshot.owner, snapshot.path));
        }
      } catch (error) { notifyError(error); }
    });
    chains.set(key, write);
    return write;
  });
  await Promise.all(writes);
}

export function accountStateReady(): boolean { return hydrated && account !== null; }
export function getAccountSetting<T>(key: string, fallback: T): T {
  return (settings.preferences?.[key] as T | undefined) ?? fallback;
}
export function setAccountSetting(key: string, value: unknown): void {
  settings = { ...settings, preferences: { ...settings.preferences, [key]: value } };
  schedule("/settings/user", settings);
}

export async function hydrateAccountState(owner: string | null): Promise<void> {
  const token = getAuthToken();
  if (owner && account?.id === owner && account.token === token && hydrated) return;
  const current = ++generation;
  account = owner ? { id: owner, token } : null;
  hydrated = false;
  applying = true;
  settings = {};
  hydrateChatState(null);
  hydrateSettings();
  applying = false;
  window.dispatchEvent(new Event("account:changed"));
  await flushAccountState();
  if (current !== generation) return;
  if (!owner) return;
  try {
    const [chat, prefs] = await Promise.all([
      requestJson<{ data: PersistedChatState | null }>("/conversations/state", { headers: { Authorization: `Bearer ${token}` } }),
      requestJson<{ data: UserSettings }>("/settings/user", { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (current !== generation) return;
    for (const path of ["/conversations/state", "/settings/user"]) {
      const key = `${owner}:${path}`;
      const draft = localStorage.getItem(journalKey(owner, path));
      if (draft) {
        const existing = pending.get(key);
        pending.set(key, { owner, token, path, data: existing?.data ?? JSON.parse(draft), revision: existing?.revision ?? 1 });
      }
    }
    applying = true;
    settings = (pending.get(`${owner}:/settings/user`)?.data as UserSettings | undefined) ?? prefs.data ?? {};
    hydrateSettings(settings);
    hydrateChatState((pending.get(`${owner}:/conversations/state`)?.data as PersistedChatState | undefined) ?? chat.data);
    hydrated = true;
    window.dispatchEvent(new Event("account:hydrated"));
    void flushAccountState();
  } catch (error) { if (current === generation) { notifyError(error); throw error; } }
  finally { if (current === generation) applying = false; }
}

/** Called only after the person selects the shared legacy source and confirms the target account. */
export async function importLegacyChats(): Promise<void> {
  if (!accountStateReady()) throw new Error("Sign in and wait for your account to load before importing.");
  const owner = account!.id;
  const token = account!.token;
  await flushAccountState();
  if (pending.has(`${owner}:/conversations/state`)) throw new Error("Save your current chats successfully before importing.");
  const raw = localStorage.getItem("ai-server-chat-storage");
  if (!raw) throw new Error("No legacy chats were found on this installation.");
  const legacy = JSON.parse(raw) as { state?: PersistedChatState };
  if (!legacy.state?.tabs || !legacy.state.messagesMap) throw new Error("The legacy chat source is invalid.");
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sourceId = `legacy-localStorage:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")}`;
  const imported = await requestJson<{ data: PersistedChatState }>("/conversations/import", {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ data: legacy.state, source_id: sourceId }),
  });
  if (account?.id === owner && account.token === token) {
    applying = true;
    hydrateChatState(imported.data);
    applying = false;
  }
}

useChatStore.subscribe(state => schedule("/conversations/state", { tabs: state.tabs, messagesMap: state.messagesMap, activeTab: state.activeTab }));
useSettingsStore.subscribe(state => {
  if (applying) return;
  settings = { ...settings, appearance: state.appearance, chat: state.chat, advanced: state.advanced, about: state.about };
  schedule("/settings/user", settings);
});
if (typeof window !== "undefined") {
  window.addEventListener("auth:changing", () => {
    void flushAccountState();
    generation += 1;
    account = null;
    hydrated = false;
    applying = true;
    settings = {};
    hydrateChatState(null);
    hydrateSettings();
    applying = false;
    window.dispatchEvent(new Event("account:changed"));
  });
  window.addEventListener("pagehide", () => { void flushAccountState(); });
  window.addEventListener("online", () => { void flushAccountState(); });
}
