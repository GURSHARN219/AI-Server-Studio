/** JSON values accepted by workflow graph, run, and event payloads. */
export type WorkflowJsonValue =
  | null
  | boolean
  | number
  | string
  | WorkflowJsonValue[]
  | { [key: string]: WorkflowJsonValue };

/** A known value remains discoverable while allowing future backend values. */
export type WorkflowRunStatus =
  | "queued"
  | "validating"
  | "running"
  | "waiting"
  | "waiting_approval"
  | "blocked_policy"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"
  | (string & {});

export type WorkflowStepStatus =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped"
  | (string & {});

export type WorkflowStepDefinition = {
  id: string;
  stepType?: string;
  dependencies?: string[];
  input?: WorkflowJsonValue;
};

export type WorkflowGraph = {
  steps: WorkflowStepDefinition[];
};

export type WorkflowDefinition = {
  id: string;
  ownerId: string;
  name: string;
  currentVersion: number;
  createdAt: number;
};

export type WorkflowVersion = {
  definitionId: string;
  ownerId: string;
  version: number;
  graph: WorkflowGraph;
  checksum: string;
  createdAt: number;
};

export type WorkflowStep = {
  id: string;
  stepType?: string;
  status: WorkflowStepStatus;
  dependencies?: string[];
  attempt: number;
  revision: number;
  input?: WorkflowJsonValue;
  output?: WorkflowJsonValue;
  errorSummary?: string;
  startedAt?: number;
  finishedAt?: number;
};

export type WorkflowRun = {
  id: string;
  ownerId: string;
  definitionId: string;
  version: number;
  status: WorkflowRunStatus;
  revision: number;
  input: WorkflowJsonValue;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  errorCode?: string;
  errorSummary?: string;
  steps: WorkflowStep[];
};

export type WorkflowEvent = {
  runId: string;
  ownerId: string;
  sequence: number;
  type: string;
  timestamp: number;
  data?: WorkflowJsonValue;
};

export type WorkflowListResponse<T> = {
  object: "list";
  data: T[];
};

export type WorkflowEventListResponse = WorkflowListResponse<WorkflowEvent> & {
  after: number;
};

export type CreateWorkflowDefinitionRequest = {
  name: string;
  graph: WorkflowGraph;
};

export type CreateWorkflowVersionRequest = {
  graph: WorkflowGraph;
};

export type CreateWorkflowRunRequest = {
  version?: number;
  input?: WorkflowJsonValue;
  metadata?: { [key: string]: WorkflowJsonValue };
};

export type ListWorkflowEventsOptions = {
  after?: number;
  limit?: number;
  signal?: AbortSignal;
};
