import { requestJson } from "@/api/client";
import type {
  CreateWorkflowDefinitionRequest,
  CreateWorkflowRunRequest,
  CreateWorkflowVersionRequest,
  ListWorkflowEventsOptions,
  WorkflowDefinition,
  WorkflowEventListResponse,
  WorkflowGraph,
  WorkflowListResponse,
  WorkflowRun,
  WorkflowVersion,
} from "@/types/workflows";

const workflowPathSegment = (value: string | number): string => encodeURIComponent(String(value));

const versionRequest = (request: WorkflowGraph | CreateWorkflowVersionRequest): CreateWorkflowVersionRequest =>
  "graph" in request ? request : { graph: request };

export async function listWorkflowDefinitions(signal?: AbortSignal): Promise<WorkflowListResponse<WorkflowDefinition>> {
  return requestJson<WorkflowListResponse<WorkflowDefinition>>("/workflows", { signal });
}

export async function getWorkflowDefinition(id: string, signal?: AbortSignal): Promise<WorkflowDefinition> {
  return requestJson<WorkflowDefinition>(`/workflows/${workflowPathSegment(id)}`, { signal });
}

export async function getWorkflowVersion(definitionId: string, version: number, signal?: AbortSignal): Promise<WorkflowVersion> {
  return requestJson<WorkflowVersion>(
    `/workflows/${workflowPathSegment(definitionId)}/versions/${workflowPathSegment(version)}`,
    { signal },
  );
}

export async function createWorkflowVersion(
  definitionId: string,
  request: WorkflowGraph | CreateWorkflowVersionRequest,
  signal?: AbortSignal,
): Promise<WorkflowVersion> {
  return requestJson<WorkflowVersion>(`/workflows/${workflowPathSegment(definitionId)}/versions`, {
    method: "POST",
    body: JSON.stringify(versionRequest(request)),
    signal,
  });
}

export async function createWorkflowRun(
  definitionId: string,
  request: CreateWorkflowRunRequest = {},
  signal?: AbortSignal,
): Promise<WorkflowRun> {
  return requestJson<WorkflowRun>(`/workflows/${workflowPathSegment(definitionId)}/runs`, {
    method: "POST",
    body: JSON.stringify(request),
    signal,
  });
}

export async function listWorkflowRuns(signal?: AbortSignal): Promise<WorkflowListResponse<WorkflowRun>> {
  return requestJson<WorkflowListResponse<WorkflowRun>>("/workflow-runs", { signal });
}

export async function getWorkflowRun(id: string, signal?: AbortSignal): Promise<WorkflowRun> {
  return requestJson<WorkflowRun>(`/workflow-runs/${workflowPathSegment(id)}`, { signal });
}

export async function listWorkflowEvents(
  runId: string,
  options: ListWorkflowEventsOptions = {},
): Promise<WorkflowEventListResponse> {
  const query = new URLSearchParams();
  if (options.after !== undefined) query.set("after", String(options.after));
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson<WorkflowEventListResponse>(`/workflow-runs/${workflowPathSegment(runId)}/events${suffix}`, {
    signal: options.signal,
  });
}

export async function createWorkflowDefinition(
  request: CreateWorkflowDefinitionRequest,
  signal?: AbortSignal,
): Promise<WorkflowDefinition> {
  return requestJson<WorkflowDefinition>("/workflows", {
    method: "POST",
    body: JSON.stringify(request),
    signal,
  });
}
