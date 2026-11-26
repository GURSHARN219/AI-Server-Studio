import { beforeEach, describe, expect, it, vi } from "vitest";
import { setEnginePort } from "@/lib/localEngine";
import { listWorkflowDefinitions, createWorkflowVersion, createWorkflowRun, listWorkflowEvents } from "@/api/workflows";

const fetchMock = vi.fn();

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("workflow API contract", () => {
  beforeEach(() => {
    setEnginePort(1234);
    localStorage.clear();
    localStorage.setItem("ai-server-auth-token", "workflow-test-token");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("lists definitions through the authenticated local client", async () => {
    fetchMock.mockResolvedValue(respond({ object: "list", data: [] }));
    await expect(listWorkflowDefinitions()).resolves.toEqual({ object: "list", data: [] });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3000/v1/workflows");
    expect(fetchMock.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer workflow-test-token");
  });

  it("encodes version identifiers and sends the verified graph payload", async () => {
    fetchMock.mockResolvedValue(respond({ definitionId: "flow/a", version: 2, graph: { steps: [] } }));
    await createWorkflowVersion("flow/a", { graph: { steps: [] } });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3000/v1/workflows/flow%2Fa/versions");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ graph: { steps: [] } });
  });

  it("creates queued runs and serializes the durable event cursor", async () => {
    fetchMock.mockResolvedValueOnce(respond({ id: "run-1", status: "queued" }));
    await createWorkflowRun("flow-1", { version: 2, input: { prompt: "hello" } });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3000/v1/workflows/flow-1/runs");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ version: 2, input: { prompt: "hello" } });

    fetchMock.mockResolvedValueOnce(respond({ object: "list", data: [], after: 4 }));
    await listWorkflowEvents("run-1", { after: 4, limit: 25 });
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:3000/v1/workflow-runs/run-1/events?after=4&limit=25");
  });
});
