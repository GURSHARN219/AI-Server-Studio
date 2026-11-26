import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  createWorkflowRun,
  createWorkflowVersion,
  getWorkflowVersion,
  listWorkflowDefinitions,
  listWorkflowRuns,
  getWorkflowRun,
} from "@/api/workflows";
import type { WorkflowDefinition, WorkflowGraph, WorkflowRun, WorkflowVersion } from "@/types/workflows";
import WorkflowDefinitionList from "@/components/workflows/WorkflowDefinitionList";
import WorkflowRunDetail from "@/components/workflows/WorkflowRunDetail";
import WorkflowStatusBadge from "@/components/workflows/WorkflowStatusBadge";
import WorkflowVersionDetail from "@/components/workflows/WorkflowVersionDetail";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The workflow request failed.";
}

function prettyGraph(graph: WorkflowGraph | null): string {
  return graph ? JSON.stringify(graph, null, 2) : JSON.stringify({ steps: [] }, null, 2);
}

export default function WorkflowsPage() {
  const { toast } = useToast();
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [definitionsLoading, setDefinitionsLoading] = useState(true);
  const [definitionsError, setDefinitionsError] = useState<string | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedDefinition, setSelectedDefinition] = useState<WorkflowDefinition | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<WorkflowVersion | null>(null);
  const [versionNumber, setVersionNumber] = useState("");
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [graphJson, setGraphJson] = useState(prettyGraph(null));
  const [runInputJson, setRunInputJson] = useState("{}");
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);

  const loadDefinitions = useCallback(async (signal?: AbortSignal) => {
    setDefinitionsLoading(true);
    setDefinitionsError(null);
    try {
      const response = await listWorkflowDefinitions(signal);
      setDefinitions(response.data ?? []);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDefinitionsError(errorMessage(error));
    } finally {
      if (!signal?.aborted) setDefinitionsLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (signal?: AbortSignal) => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const response = await listWorkflowRuns(signal);
      setRuns(response.data ?? []);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setRunsError(errorMessage(error));
    } finally {
      if (!signal?.aborted) setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadDefinitions(controller.signal);
    void loadRuns(controller.signal);
    return () => controller.abort();
  }, [loadDefinitions, loadRuns]);

  const loadVersion = useCallback(async (definitionId: string, requestedVersion: string) => {
    const parsedVersion = Number.parseInt(requestedVersion, 10);
    if (!Number.isInteger(parsedVersion) || parsedVersion <= 0) {
      setVersionError("Enter a valid version number.");
      return;
    }
    setVersionLoading(true);
    setVersionError(null);
    try {
      const version = await getWorkflowVersion(definitionId, parsedVersion);
      setSelectedVersion(version);
      setGraphJson(prettyGraph(version.graph));
    } catch (error) {
      setSelectedVersion(null);
      setVersionError(errorMessage(error));
    } finally {
      setVersionLoading(false);
    }
  }, []);

  const selectDefinition = useCallback((definition: WorkflowDefinition) => {
    setSelectedDefinition(definition);
    setSelectedRun(null);
    setSelectedVersion(null);
    setVersionNumber(String(definition.currentVersion));
    void loadVersion(definition.id, String(definition.currentVersion));
  }, [loadVersion]);

  const selectRun = useCallback(async (run: WorkflowRun) => {
    try {
      const latest = await getWorkflowRun(run.id);
      setSelectedRun(latest);
    } catch (error) {
      toast({ title: "Could not load workflow run", description: errorMessage(error), variant: "destructive" });
    }
  }, [toast]);

  const handleCreateVersion = async () => {
    if (!selectedDefinition) return;
    let graph: WorkflowGraph;
    try {
      graph = JSON.parse(graphJson) as WorkflowGraph;
    } catch {
      setVersionError("The graph must be valid JSON.");
      return;
    }
    setCreatingVersion(true);
    setVersionError(null);
    try {
      const created = await createWorkflowVersion(selectedDefinition.id, { graph });
      setSelectedVersion(created);
      setVersionNumber(String(created.version));
      setGraphJson(prettyGraph(created.graph));
      setSelectedDefinition((current) => current ? { ...current, currentVersion: Math.max(current.currentVersion, created.version) } : current);
      setDefinitions((current) => current.map((item) => item.id === selectedDefinition.id ? { ...item, currentVersion: Math.max(item.currentVersion, created.version) } : item));
      toast({ title: `Published workflow version ${created.version}` });
    } catch (error) {
      setVersionError(errorMessage(error));
    } finally {
      setCreatingVersion(false);
    }
  };

  const handleCreateRun = async () => {
    if (!selectedDefinition || !selectedVersion) return;
    let input: unknown;
    try {
      input = JSON.parse(runInputJson);
    } catch {
      toast({ title: "Invalid run input", description: "Run input must be valid JSON.", variant: "destructive" });
      return;
    }
    setCreatingRun(true);
    try {
      const created = await createWorkflowRun(selectedDefinition.id, { version: selectedVersion.version, input: input as WorkflowRun["input"] });
      setRuns((current) => [created, ...current.filter((run) => run.id !== created.id)]);
      setSelectedRun(created);
      toast({ title: "Queued workflow run created", description: "The current public API does not start workflow execution." });
    } catch (error) {
      toast({ title: "Could not create workflow run", description: errorMessage(error), variant: "destructive" });
    } finally {
      setCreatingRun(false);
    }
  };

  const visibleRuns = useMemo(() => selectedDefinition ? runs.filter((run) => run.definitionId === selectedDefinition.id) : runs, [runs, selectedDefinition]);

  if (selectedRun) {
    return <WorkflowRunDetail run={selectedRun} onBack={() => setSelectedRun(null)} />;
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden" data-testid="workflows-page">
      <div className="flex min-h-0 flex-1">
        <WorkflowDefinitionList
          definitions={definitions}
          selectedId={selectedDefinition?.id ?? null}
          loading={definitionsLoading}
          error={definitionsError}
          onRetry={() => void loadDefinitions()}
          onSelect={selectDefinition}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedDefinition ? (
            <WorkflowVersionDetail
              definition={selectedDefinition}
              version={selectedVersion}
              versionNumber={versionNumber}
              loading={versionLoading}
              error={versionError}
              onVersionNumberChange={setVersionNumber}
              onLoadVersion={() => void loadVersion(selectedDefinition.id, versionNumber)}
              graphJson={graphJson}
              onGraphJsonChange={setGraphJson}
              creatingVersion={creatingVersion}
              onCreateVersion={() => void handleCreateVersion()}
              runInputJson={runInputJson}
              onRunInputJsonChange={setRunInputJson}
              creatingRun={creatingRun}
              onCreateRun={() => void handleCreateRun()}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <ClipboardList className="mb-3 h-10 w-10 text-muted-foreground/30" aria-hidden="true" />
              <h1 className="text-sm font-semibold text-foreground">Workflow definitions</h1>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">Select a workflow definition to inspect its immutable versions, dependencies, and persisted runs.</p>
            </div>
          )}

          <section className="max-h-48 shrink-0 border-t border-border bg-background px-4 py-3" aria-labelledby="workflow-runs-title">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div><h2 id="workflow-runs-title" className="text-sm font-semibold">Persisted runs</h2><p className="text-[10px] text-muted-foreground">Read-only lifecycle state from the backend</p></div>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void loadRuns()} aria-label="Refresh workflow runs" disabled={runsLoading}><RefreshCw className={`h-3.5 w-3.5 ${runsLoading ? "animate-spin" : ""}`} aria-hidden="true" /></Button>
            </div>
            {runsError && <div className="flex items-center justify-between gap-2 text-xs text-destructive" role="alert"><span>{runsError}</span><Button type="button" variant="outline" size="sm" className="h-7" onClick={() => void loadRuns()}>Try again</Button></div>}
            {!runsError && runsLoading && <div className="h-8 animate-pulse rounded bg-muted/50" role="status"><span className="sr-only">Loading workflow runs</span></div>}
            {!runsError && !runsLoading && visibleRuns.length === 0 && <p className="text-xs text-muted-foreground">No persisted runs for this selection.</p>}
            {!runsError && !runsLoading && visibleRuns.length > 0 && <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Persisted workflow runs">{visibleRuns.map((run) => <li key={run.id} className="min-w-[210px]"><button type="button" className="w-full rounded-md border border-border px-3 py-2 text-left hover:bg-muted/40" onClick={() => void selectRun(run)}><span className="block truncate font-mono text-[10px] text-foreground">{run.id}</span><span className="mt-1 flex items-center justify-between gap-2"><span className="text-[10px] text-muted-foreground">v{run.version} · rev {run.revision}</span><WorkflowStatusBadge status={run.status} /></span></button></li>)}</ul>}
          </section>
        </div>
      </div>
    </div>
  );
}
