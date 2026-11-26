import { RefreshCw, Workflow as WorkflowIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkflowDefinition } from "@/types/workflows";

type Props = {
  definitions: WorkflowDefinition[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (definition: WorkflowDefinition) => void;
};

export default function WorkflowDefinitionList({ definitions, selectedId, loading, error, onRetry, onSelect }: Props) {
  return (
    <section className="flex min-h-0 w-[min(32vw,360px)] min-w-[250px] shrink-0 flex-col border-r border-border bg-background" aria-labelledby="workflow-list-title">
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <div>
          <h2 id="workflow-list-title" className="text-sm font-semibold text-foreground">Workflows</h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Immutable definitions</p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onRetry} aria-label="Refresh workflows" disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="space-y-2 p-2" role="status" aria-live="polite">
            {[1, 2, 3].map((item) => <div key={item} className="h-14 animate-pulse rounded-md bg-muted/50" />)}
            <span className="sr-only">Loading workflows</span>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs" role="alert">
            <p className="font-medium text-destructive">Could not load workflows</p>
            <p className="mt-1 text-muted-foreground">{error}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3 h-7 text-xs" onClick={onRetry}>Try again</Button>
          </div>
        )}

        {!loading && !error && definitions.length === 0 && (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center" role="status">
            <WorkflowIcon className="mb-3 h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">No workflows yet</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Workflow definitions created by an authorized client will appear here.</p>
          </div>
        )}

        {!loading && !error && definitions.length > 0 && (
          <ul className="space-y-1" aria-label="Workflow definitions">
            {definitions.map((definition) => {
              const selected = selectedId === definition.id;
              return (
                <li key={definition.id}>
                  <button
                    type="button"
                    className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${selected ? "border-primary/40 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/40"}`}
                    onClick={() => onSelect(definition)}
                    aria-pressed={selected}
                  >
                    <span className="block truncate text-xs font-medium text-foreground">{definition.name}</span>
                    <span className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                      <span className="truncate">{definition.id}</span>
                      <span className="shrink-0">v{definition.currentVersion}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
