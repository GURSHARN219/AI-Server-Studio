import { ArrowRight, GitBranch, LockKeyhole, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WorkflowDefinition, WorkflowVersion } from "@/types/workflows";

type Props = {
  definition: WorkflowDefinition;
  version: WorkflowVersion | null;
  versionNumber: string;
  loading: boolean;
  error: string | null;
  onVersionNumberChange: (value: string) => void;
  onLoadVersion: () => void;
  graphJson: string;
  onGraphJsonChange: (value: string) => void;
  creatingVersion: boolean;
  onCreateVersion: () => void;
  runInputJson: string;
  onRunInputJsonChange: (value: string) => void;
  creatingRun: boolean;
  onCreateRun: () => void;
};

function formatTimestamp(value?: number): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default function WorkflowVersionDetail({
  definition,
  version,
  versionNumber,
  loading,
  error,
  onVersionNumberChange,
  onLoadVersion,
  graphJson,
  onGraphJsonChange,
  creatingVersion,
  onCreateVersion,
  runInputJson,
  onRunInputJsonChange,
  creatingRun,
  onCreateRun,
}: Props) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto" aria-labelledby="workflow-detail-title">
      <div className="border-b border-border px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Workflow definition</p>
            <h1 id="workflow-detail-title" className="mt-1 text-lg font-semibold text-foreground">{definition.name}</h1>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{definition.id}</p>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[10px] text-muted-foreground">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
            Published versions are immutable
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="workflow-version">Inspect version</Label>
            <Input id="workflow-version" inputMode="numeric" value={versionNumber} onChange={(event) => onVersionNumberChange(event.target.value)} className="h-8 w-24 text-xs" />
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={onLoadVersion} disabled={loading || !versionNumber.trim()}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            Load version
          </Button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {loading && <div className="h-32 animate-pulse rounded-md bg-muted/50" role="status"><span className="sr-only">Loading workflow version</span></div>}
        {!loading && error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" role="alert">{error}</div>}
        {!loading && !error && version && (
          <>
            <div className="grid gap-2 text-[11px] sm:grid-cols-3">
              <div className="rounded-md border border-border bg-muted/20 p-3"><span className="text-muted-foreground">Version</span><strong className="ml-2 font-mono text-foreground">v{version.version}</strong></div>
              <div className="rounded-md border border-border bg-muted/20 p-3"><span className="text-muted-foreground">Created</span><strong className="ml-2 text-foreground">{formatTimestamp(version.createdAt)}</strong></div>
              <div className="rounded-md border border-border bg-muted/20 p-3"><span className="text-muted-foreground">Checksum</span><strong className="ml-2 block truncate font-mono text-foreground" title={version.checksum}>{version.checksum}</strong></div>
            </div>

            <section aria-labelledby="workflow-steps-title">
              <div className="mb-2 flex items-center gap-2"><GitBranch className="h-4 w-4 text-primary" aria-hidden="true" /><h2 id="workflow-steps-title" className="text-sm font-semibold">Steps and dependencies</h2></div>
              <ol className="space-y-2">
                {version.graph.steps.map((step, index) => (
                  <li key={step.id} className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-start gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] text-primary">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-foreground">{step.id}</span>{step.stepType && <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{step.stepType}</span>}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground"><span>Depends on:</span>{step.dependencies?.length ? step.dependencies.map((dependency) => <span key={dependency} className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{dependency}</span>) : <span>none</span>}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="grid gap-4 border-t border-border pt-4 lg:grid-cols-2" aria-labelledby="workflow-actions-title">
              <div>
                <h2 id="workflow-actions-title" className="text-sm font-semibold">Create a new immutable version</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">Edit the graph JSON below to publish a new version. Existing versions will not change.</p>
                <Label htmlFor="workflow-graph-json" className="sr-only">New workflow graph JSON</Label>
                <textarea id="workflow-graph-json" value={graphJson} onChange={(event) => onGraphJsonChange(event.target.value)} className="mt-3 min-h-36 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[10px] outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" spellCheck={false} />
                <Button type="button" size="sm" className="mt-2" onClick={onCreateVersion} disabled={creatingVersion}>{creatingVersion ? "Publishing…" : "Publish new version"}</Button>
              </div>
              <div>
                <h2 className="text-sm font-semibold">Create a queued run</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">This creates a persisted queued run. The current public API does not start workflow execution.</p>
                <Label htmlFor="workflow-run-input" className="sr-only">Queued run input JSON</Label>
                <textarea id="workflow-run-input" value={runInputJson} onChange={(event) => onRunInputJsonChange(event.target.value)} className="mt-3 min-h-36 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[10px] outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" spellCheck={false} />
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onCreateRun} disabled={creatingRun}>{creatingRun ? "Creating…" : "Create queued run"}</Button>
              </div>
            </section>
          </>
        )}
        {!loading && !error && !version && <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">Select a version to inspect its graph.</div>}
      </div>
    </section>
  );
}
