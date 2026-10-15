import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { getAccountSetting, setAccountSetting, hydrateAccountState, flushAccountState, importLegacyChats } from "@/stores/accountState";
import { useChatStore, type PersistedChatState } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { setAuthToken } from "@/api/auth";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const state = (owner: string): PersistedChatState => ({ tabs: [{ id: owner, title: owner, type: "chat" }], messagesMap: { [owner]: [{ id: `m-${owner}`, role: "user", content: owner, timestamp: 1 }] }, activeTab: owner });
const fetchMock = vi.fn();
let saved: Record<string, PersistedChatState>;
let writes: { token: string; url: string; body: { data: PersistedChatState; source_id?: string } }[];

describe("account-scoped authoritative state", () => {
  beforeEach(async () => {
    await hydrateAccountState(null);
    localStorage.clear(); saved = { A: state("A"), B: state("B") }; writes = [];
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const token = init.headers instanceof Headers ? init.headers.get("Authorization")!.replace("Bearer ", "") : "";
      const owner = token.endsWith("B") ? "B" : "A";
      if (init.method === "PUT" || init.method === "POST") {
        const body = JSON.parse(String(init.body));
        writes.push({ token, url, body });
        if (url.includes("conversations/state")) saved[owner] = body.data;
        return json({ data: url.includes("/import") ? saved[owner] : body.data });
      }
      return json({ data: url.includes("conversations") ? saved[owner] : { appearance: { fontSize: owner === "A" ? 18 : 22 }, preferences: { owner } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", webcrypto);
  });
  afterEach(async () => { await flushAccountState(); await hydrateAccountState(null); vi.unstubAllGlobals(); });
  async function login(owner: string) { setAuthToken(`session-${owner}`); await hydrateAccountState(owner); }
  it("loads chat/settings from the verified owner and ignores shared legacy sources", async () => {
    localStorage.setItem("ai-server-chat-storage", JSON.stringify({ state: state("legacy") }));
    localStorage.setItem("app:settings:v2", JSON.stringify({ state: { appearance: { fontSize: 99 } } }));
    await login("A");
    expect(useChatStore.getState().activeTab).toBe("A");
    expect(useSettingsStore.getState().appearance.fontSize).toBe(18);
    expect(getAccountSetting("owner", "")).toBe("A");
    expect(writes.some(write => write.url.includes("/import"))).toBe(false);
  });
  it("flushes a pending chat debounce with A's captured bearer when switching to B", async () => {
    await login("A");
    useChatStore.getState().addMessage("A", { id: "new", role: "user", content: "A unsaved", timestamp: 2 });
    await login("B");
    expect(writes.find(write => write.url.endsWith("/conversations/state"))?.token).toBe("session-A");
    expect(saved.A.messagesMap.A).toHaveLength(2);
    expect(useChatStore.getState().activeTab).toBe("B");
    expect(useChatStore.getState().messagesMap.A).toBeUndefined();
    expect(getAccountSetting("owner", "")).toBe("B");
  });
  it("resets account state synchronously before a switched account can render", async () => {
    await login("A");
    setAuthToken("session-B");
    expect(useChatStore.getState().messagesMap.A).toBeUndefined();
    expect(getAccountSetting("owner", "empty")).toBe("empty");
  });
  it("retains failed writes in an owner-scoped outbox and retries only for that owner", async () => {
    await login("A");
    fetchMock.mockResolvedValueOnce(json({ error: "offline" }, 503));
    useChatStore.getState().addMessage("A", { id: "offline", role: "user", content: "pending A", timestamp: 2 });
    await flushAccountState();
    expect(localStorage.getItem("ai-server-pending:A:/conversations/state")).toContain("pending A");
    expect(localStorage.getItem("ai-server-pending:B:/conversations/state")).toBeNull();
    await login("B");
    expect(useChatStore.getState().messagesMap.A).toBeUndefined();
    expect(saved.A.messagesMap.A).toHaveLength(2);
    expect(localStorage.getItem("ai-server-pending:A:/conversations/state")).toBeNull();
  });
  it("does not let stale hydration overwrite a new account", async () => {
    let resolveA!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveA = resolve; }));
    setAuthToken("session-A");
    const first = hydrateAccountState("A");
    await Promise.resolve(); await Promise.resolve();
    await login("B");
    resolveA(json({ data: state("A") }));
    await first;
    expect(useChatStore.getState().activeTab).toBe("B");
  });
  it("uses server user-settings for preferences and keeps writes secret-free", async () => {
    await login("A");
    setAccountSetting("model-selection", "m1");
    useSettingsStore.getState().setChat("autoNaming", "never");
    await flushAccountState();
    const write = writes.find(write => write.url.endsWith("/settings/user"));
    expect(write?.token).toBe("session-A");
    expect(JSON.stringify(write?.body)).toContain("model-selection");
    expect(JSON.stringify(write?.body)).not.toContain("session-A");
  });
  it("requires a verified account before any explicit import", async () => {
    localStorage.setItem("ai-server-chat-storage", JSON.stringify({ state: state("legacy") }));
    await expect(importLegacyChats()).rejects.toThrow("Sign in");
    expect(writes).toEqual([]);
  });
  it("submits stable idempotency source IDs for explicit import and preserves its legacy source", async () => {
    const legacy = JSON.stringify({ state: state("legacy") });
    localStorage.setItem("ai-server-chat-storage", legacy);
    await login("A");
    await importLegacyChats(); await importLegacyChats();
    const imports = writes.filter(write => write.url.endsWith("/import"));
    expect(imports).toHaveLength(2);
    expect(imports[0].body.source_id).toBe(imports[1].body.source_id);
    expect(imports[0].token).toBe("session-A");
    expect(imports[0].body.data).toEqual(state("legacy"));
    expect(localStorage.getItem("ai-server-chat-storage")).toBe(legacy);
    expect(useChatStore.getState().activeTab).toBe("A");
  });
});
