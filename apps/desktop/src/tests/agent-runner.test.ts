import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentRunner } from "@/hooks/useAgentRunner";
import type { AgentRunnerConfig } from "@/lib/agent";

vi.mock("@/lib/localEngine", () => ({ getEnginePort: () => 9090 }));
const config: Omit<AgentRunnerConfig, "onEvent"> = {
  provider: { id: "saved-provider", name: "Test", baseUrl: "https://external.example/v1", apiKey: "never-send-this", enabled: true },
  modelName: "test", tools: [], mcpToolDefs: [], mcpServers: [], executionMode: "online",
};
const fetchMock = vi.fn();
let streams: { controller: ReadableStreamDefaultController<Uint8Array>; url: string; signal: AbortSignal }[];
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const emit = (index: number, data: unknown, id?: string) => streams[index].controller.enqueue(new TextEncoder().encode(`${id ? `id: ${id}\r\n` : ""}data: ${JSON.stringify(data)}\r\n\r\n`));
const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("authorized fetch agent streams", () => {
  beforeEach(() => {
    vi.useFakeTimers(); streams = []; fetchMock.mockReset(); localStorage.clear();
    localStorage.setItem("ai-server-auth-token", "session-test");
    let number = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/events")) {
        const body = new ReadableStream<Uint8Array>({ start(controller) { streams.push({ controller, url, signal: init.signal as AbortSignal }); } });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      }
      if (url.endsWith("/cancel")) return json({ ok: true });
      if (init.method === "POST") return json({ id: `run-${++number}` });
      return json({ result: "Finished", plan: { goal: "Test", steps: [], createdAt: 1 } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("AbortSignal", { timeout: () => new AbortController().signal });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  async function start() {
    const hook = renderHook(useAgentRunner);
    await act(async () => hook.result.current.startAgent("Test", config));
    return hook;
  }
  it("authenticates SSE and sends only a saved provider ID", async () => {
    await start();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).provider).toEqual({ id: "saved-provider" });
    const request = fetchMock.mock.calls.find(([url]) => url.includes("/events"))!;
    expect(request[1].headers.get("Authorization")).toBe("Bearer session-test");
    expect(request[0]).not.toContain("token=");
  });
  it("suppresses duplicates and reconnects with the highest sequence including SSE ids", async () => {
    const hook = await start();
    await act(async () => {
      emit(0, { type: "plan_created", sequence: 1, data: { plan: { goal: "Test", steps: [], createdAt: 1 } } });
      emit(0, { type: "plan_created", sequence: 1 });
      emit(0, { type: "checkpoint", sequence: 2 });
      emit(0, { type: "step_done", data: { stepId: "s", answer: "Done" } }, "3");
    });
    expect(hook.result.current.events).toHaveLength(2);
    await act(async () => streams[0].controller.close());
    await advance(500);
    expect(streams[1].url).toContain("?cursor=3");
    await act(async () => emit(1, { type: "agent_done", sequence: 2 }));
    expect(hook.result.current.status).toBe("running");
  });
  it("bounds retries with backoff and resets the budget after progress", async () => {
    const hook = await start();
    for (const delay of [500, 1000]) {
      await act(async () => streams[streams.length - 1].controller.close());
      await advance(delay);
    }
    await act(async () => emit(2, { type: "checkpoint", sequence: 1 }));
    await act(async () => streams[2].controller.close());
    await advance(500);
    expect(streams).toHaveLength(4);
    for (const delay of [1000, 2000, 4000, 8000]) {
      await act(async () => streams[streams.length - 1].controller.close());
      await advance(delay);
    }
    await act(async () => streams[streams.length - 1].controller.close());
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.error).toContain("disconnected");
  });
  it("finishes once and cancels the fetch reader", async () => {
    const hook = await start();
    await act(async () => emit(0, { type: "agent_done", sequence: 1, data: { answer: "Finished" } }));
    expect(hook.result.current.status).toBe("done");
    expect(hook.result.current.result?.answer).toBe("Finished");
    expect(streams[0].signal.aborted).toBe(true);
    await advance(60000);
    expect(streams).toHaveLength(1);
  });
  it("cancels a run and a pending reconnect", async () => {
    const hook = await start();
    await act(async () => streams[0].controller.close());
    await act(async () => hook.result.current.abortAgent());
    await advance(60000);
    expect(hook.result.current.status).toBe("idle");
    expect(streams).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/run-1/cancel"))).toBe(true);
  });
  it("stops on auth failure rather than reconnecting", async () => {
    fetchMock.mockImplementationOnce(async () => json({ id: "run-1" }));
    fetchMock.mockImplementationOnce(async () => new Response("Unauthorized", { status: 401 }));
    const hook = await start();
    expect(hook.result.current.error).toContain("Sign in again");
    await advance(60000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("cancels creation that completes after an abort", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    const hook = renderHook(useAgentRunner);
    await act(async () => hook.result.current.startAgent("Test", config));
    act(() => hook.result.current.abortAgent());
    await act(async () => resolve(json({ id: "late" })));
    expect(hook.result.current.status).toBe("idle");
    expect(streams).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/late/cancel"))).toBe(true);
  });
  it("aborts streams and resets output on account switch", async () => {
    const hook = await start();
    await act(async () => window.dispatchEvent(new Event("account:changed")));
    expect(streams[0].signal.aborted).toBe(true);
    expect(hook.result.current.events).toEqual([]);
    expect(hook.result.current.status).toBe("idle");
  });
});
