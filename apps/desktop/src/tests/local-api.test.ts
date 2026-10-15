import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, engineFetch, requestJson } from "@/api/client";
import { authBackendSignIn, authBackendSignUp, createBackendApiKey, listBackendApiKeys, listBackendProviders, sendBackendAgenticChat, sendChatCompletionWithTools, updateBackendProvider, fetchAvailableModels, sendBackendProviderTranscription } from "@/lib/api";
import { hydrateAccountState } from "@/stores/accountState";
import { setEnginePort } from "@/lib/localEngine";
import { discoverMcpTools, executeMcpToolCall } from "@/lib/mcpOperations";

const fetchMock = vi.fn();
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
describe("local typed API and secret boundaries", () => {
  beforeEach(async () => {
    await hydrateAccountState(null); localStorage.clear(); setEnginePort(1234); fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue(respond({ data: [] }));
    localStorage.setItem("ai-server-auth-token", "test-session");
  });
  afterEach(() => vi.unstubAllGlobals());
  it("adds session authorization to protected local requests", async () => {
    await requestJson("/providers");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:1234/v1/providers");
    expect(fetchMock.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer test-session");
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
  });
  it("supports the engine loopback alias but never adds auth to external hosts or other ports", async () => {
    await engineFetch("http://127.0.0.1:1234/v1/models");
    await engineFetch("https://huggingface.co/api/models");
    await engineFetch("http://localhost:4002/v1/models", { headers: { Authorization: "Bearer test-session" } });
    expect(fetchMock.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer test-session");
    expect(fetchMock.mock.calls[1][1].headers.has("Authorization")).toBe(false);
    expect(fetchMock.mock.calls[2][1].headers.has("Authorization")).toBe(false);
  });
  it("rejects absolute URLs in the typed local client", async () => {
    await expect(requestJson("https://external.example/v1/profile")).rejects.toThrow("Local API path required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{ error: "Unauthorized" }, { error: { message: "Unauthorized" } }])("retains status and structured auth errors: %j", async body => {
    fetchMock.mockResolvedValue(respond(body, 401));
    await expect(requestJson("/profile")).rejects.toMatchObject({ status: 401, message: "Unauthorized", body });
  });
  it("does not hide auth failure as an empty provider list", async () => {
    fetchMock.mockResolvedValue(respond({ error: "Sign in" }, 403));
    await expect(listBackendProviders()).rejects.toBeInstanceOf(ApiError);
  });
  it.each(["signin", "signup"])("uses local %s with {token,user} without cloud env", async action => {
    const user = { id: "u", email: "u@example.test", created_at: "now" };
    fetchMock.mockResolvedValue(respond({ token: "issued-local-token", user }));
    expect(await (action === "signin" ? authBackendSignIn("u@example.test", "test-password") : authBackendSignUp("u@example.test", "test-password"))).toEqual(user);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:1234/v1/auth/${action}`);
    expect(localStorage.getItem("ai-server-auth-token")).toBe("issued-local-token");
  });
  it("receives a server-generated key once and submits no renderer hash or prefix", async () => {
    fetchMock.mockResolvedValueOnce(respond({ raw_key: "sk-ais-test-only", data: { id: "k", key_prefix: "sk-ais-test" } }));
    const created = await createBackendApiKey({ name: "CLI", rate_limit_rpm: 60 });
    expect(created.raw_key).toBe("sk-ais-test-only");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "CLI", rate_limit_rpm: 60 });
    fetchMock.mockResolvedValueOnce(respond({ data: [{ id: "k", key_prefix: "sk-ais-test" }] }));
    expect(await listBackendApiKeys()).toEqual([{ id: "k", key_prefix: "sk-ais-test" }]);
    expect(localStorage.getItem("raw_key")).toBeNull();
  });
  it("keeps provider UI state secret-free", async () => {
    fetchMock.mockResolvedValue(respond({ data: [{ id: "p", api_key: "legacy-secret", has_key: true }] }));
    expect(await listBackendProviders()).toEqual([{ id: "p", api_key: "", has_key: true }]);
  });
  it("blank provider edits never submit an empty replacement secret", async () => {
    fetchMock.mockResolvedValue(respond({ data: { id: "p", has_key: true } }));
    await updateBackendProvider("p", { name: "Renamed", api_key: "" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "Renamed" });
  });
  it("routes tool chat through the saved backend ID and ignores renderer secrets", async () => {
    const provider = { id: "p", name: "Provider", baseUrl: "https://external.example", apiKey: "renderer-secret", enabled: true };
    fetchMock.mockResolvedValue(respond({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
    expect((await sendChatCompletionWithTools(provider, [], "model")).content).toBe("ok");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:1234/v1/providers/chat/completions");
    expect(fetchMock.mock.calls[0][1].body).not.toContain("renderer-secret");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).providerId).toBe("p");
    fetchMock.mockResolvedValueOnce(respond({ content: "ok", toolCalls: [] }));
    await sendBackendAgenticChat(provider, [], "model", []);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).provider).toEqual({ id: "p" });
  });
  it("rejects unsaved direct provider model listing with actionable guidance", async () => {
    await expect(fetchAvailableModels("https://external.example/v1", "renderer-secret")).rejects.toThrow("Save this provider");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("authorizes multipart provider requests without forcing JSON content type", async () => {
    fetchMock.mockResolvedValue(respond({ text: "transcript" }));
    await sendBackendProviderTranscription("p", "stt", new File(["audio"], "audio.wav"));
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.get("Authorization")).toBe("Bearer test-session");
    expect(init.headers.has("Content-Type")).toBe(false);
    expect(init.body.get("providerId")).toBe("p");
  });
  it.each(["http://localhost:4002", "https://mcp.example.test"])("routes MCP tools through stored IDs without renderer headers: %s", async url => {
    const server = { id: "saved-mcp", name: "MCP", url, status: "connected" as const, headers: { Authorization: "renderer-secret" } };
    fetchMock.mockImplementation(async () => respond({ result: { tools: [] } }));
    await discoverMcpTools(server);
    await executeMcpToolCall(server, "test", {});
    for (const [target, init] of fetchMock.mock.calls) {
      expect(target).toBe("http://localhost:1234/v1/mcp/proxy");
      expect(init.headers.get("Authorization")).toBe("Bearer test-session");
      expect(init.body).not.toContain("renderer-secret");
      expect(JSON.parse(init.body).server_id).toBe("saved-mcp");
      expect(JSON.parse(init.body).server_url).toBeUndefined();
    }
  });
});
