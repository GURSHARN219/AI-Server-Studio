import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowDefinitionList from "@/components/workflows/WorkflowDefinitionList";
import WorkflowRunDetail from "@/components/workflows/WorkflowRunDetail";
import WorkflowStatusBadge from "@/components/workflows/WorkflowStatusBadge";
import type { WorkflowDefinition, WorkflowRun } from "@/types/workflows";
import { getWorkflowRun, listWorkflowEvents } from "@/api/workflows";

vi.mock("@/api/workflows", () => ({
  getWorkflowRun: vi.fn(),
  listWorkflowEvents: vi.fn(),
}));

const getWorkflowRunMock = vi.mocked(getWorkflowRun);
const listWorkflowEventsMock = vi.mocked(listWorkflowEvents);

const definition: WorkflowDefinition = { id: "flow-1", ownerId: "owner-1", name: "Research flow", currentVersion: 3, createdAt: 1 };
const run: WorkflowRun = {
  id: "run-1",
  ownerId: "owner-1",
  definitionId: "flow-1",
  version: 3,
  status: "queued",
  revision: 1,
  input: {},
  createdAt: 1,
  updatedAt: 1,
  steps: [{ id: "collect", status: "queued", attempt: 0, revision: 1, dependencies: [] }],
};

describe("workflow UI", () => {
  beforeEach(() => {
    getWorkflowRunMock.mockResolvedValue(run);
    listWorkflowEventsMock.mockResolvedValue({ object: "list", data: [], after: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders loading and empty states for definitions", () => {
    const { rerender } = render(<WorkflowDefinitionList definitions={[]} selectedId={null} loading onRetry={() => undefined} onSelect={() => undefined} error={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading workflows");
    rerender(<WorkflowDefinitionList definitions={[]} selectedId={null} loading={false} onRetry={() => undefined} onSelect={() => undefined} error={null} />);
    expect(screen.getByText("No workflows yet")).toBeInTheDocument();
  });

  it("renders unknown statuses safely and communicates queued execution limits", async () => {
    render(<><WorkflowStatusBadge status="future_backend_state" /><WorkflowRunDetail run={run} onBack={() => undefined} /></>);
    expect(screen.getByText("Future Backend State")).toBeInTheDocument();
    expect(screen.getByText("A queued workflow run was created. Workflow execution is not available through the current public API.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(run|execute|retry|cancel|approve)$/i })).not.toBeInTheDocument();
    expect(await screen.findByText("No persisted events yet.")).toBeInTheDocument();
  });

  it("renders a definition selection entry with version metadata", () => {
    render(<WorkflowDefinitionList definitions={[definition]} selectedId={definition.id} loading={false} onRetry={() => undefined} onSelect={() => undefined} error={null} />);
    expect(screen.getByRole("button", { name: /research flow/i })).toHaveTextContent("v3");
  });

  it("loads existing events on the initial run detail render", async () => {
    listWorkflowEventsMock.mockResolvedValueOnce({
      object: "list",
      data: [{ runId: run.id, ownerId: run.ownerId, sequence: 2, type: "step_done", timestamp: 2, data: { ok: true } }],
      after: 0,
    });

    render(<WorkflowRunDetail run={run} onBack={() => undefined} />);

    expect(screen.getByText("Loading workflow events")).toBeInTheDocument();
    expect(await screen.findByText("step_done")).toBeInTheDocument();
    expect(listWorkflowEventsMock).toHaveBeenCalledWith(run.id, expect.objectContaining({ after: 0, limit: 100, signal: expect.any(AbortSignal) }));
  });

  it("advances the cursor and deduplicates events during polling", async () => {
    vi.useFakeTimers();
    listWorkflowEventsMock
      .mockResolvedValueOnce({
        object: "list",
        data: [
          { runId: run.id, ownerId: run.ownerId, sequence: 1, type: "run_started", timestamp: 1 },
          { runId: run.id, ownerId: run.ownerId, sequence: 2, type: "step_started", timestamp: 2 },
        ],
        after: 0,
      })
      .mockResolvedValueOnce({
        object: "list",
        data: [
          { runId: run.id, ownerId: run.ownerId, sequence: 2, type: "step_started", timestamp: 2 },
          { runId: run.id, ownerId: run.ownerId, sequence: 3, type: "step_done", timestamp: 3 },
        ],
        after: 2,
    });

    render(<WorkflowRunDetail run={{ ...run, status: "running" }} onBack={() => undefined} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("run_started")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("step_done")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Workflow run events" })).getAllByRole("listitem")).toHaveLength(3);
    expect(listWorkflowEventsMock).toHaveBeenLastCalledWith("run-1", expect.objectContaining({ after: 2, limit: 100, signal: expect.any(AbortSignal) }));
    expect(screen.getByText(/Event cursor 3/)).toBeInTheDocument();
  });

  it("stops polling after the refreshed run becomes terminal", async () => {
    vi.useFakeTimers();
    getWorkflowRunMock
      .mockResolvedValueOnce({ ...run, status: "running" })
      .mockResolvedValueOnce({ ...run, status: "succeeded" });
    listWorkflowEventsMock
      .mockResolvedValueOnce({ object: "list", data: [], after: 0 })
      .mockResolvedValueOnce({ object: "list", data: [], after: 0 });

    render(<WorkflowRunDetail run={{ ...run, status: "running" }} onBack={() => undefined} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getWorkflowRunMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getWorkflowRunMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(getWorkflowRunMock).toHaveBeenCalledTimes(2);
    expect(listWorkflowEventsMock).toHaveBeenCalledTimes(2);
  });

  it("shows an event error while retaining the run detail", async () => {
    listWorkflowEventsMock.mockRejectedValueOnce(new Error("event store unavailable"));

    render(<WorkflowRunDetail run={run} onBack={() => undefined} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load workflow events: event store unavailable");
    expect(screen.getByRole("button", { name: "Refresh workflow events" })).toBeInTheDocument();
  });
});
