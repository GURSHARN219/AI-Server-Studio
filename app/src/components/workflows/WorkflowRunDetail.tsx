import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Clock3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getWorkflowRun, listWorkflowEvents } from "@/api/workflows";
import type { WorkflowEvent, WorkflowRun, WorkflowRunStatus, WorkflowStep } from "@/types/workflows";
import WorkflowStatusBadge from "@/components/workflows/WorkflowStatusBadge";

export const WORKFLOW_RUN_EVENT_LIMIT = 100;
export const WORKFLOW_RUN_POLL_INTERVAL_MS = 3000;

function isTerminalStatus(status: WorkflowRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "interrupted";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The workflow request failed.";
}

function formatTimestamp(value?: number): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatJson(value: unknown): string {
  if (value === undefined) return "—";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function EventCard({ event }: { event: WorkflowEvent }) {
  return (
    <li className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-mono text-xs font-semibold text-foreground">{event.type || "unknown event"}</h3>
          <p className="mt-1 text-[10px] text-muted-foreground">Sequence {event.sequence} · {formatTimestamp(event.timestamp)}</p>
        </div>
      </div>
      {event.data !== undefined && <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/30 p-2 font-mono text-[10px] text-foreground">{formatJson(event.data)}</pre>}
    </li>
  );
}

function StepCard({ step }: { step: WorkflowStep }) {
  return (
    <li className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-mono text-xs font-semibold text-foreground">{step.id}</h3><p className="mt-1 text-[10px] text-muted-foreground">Dependencies: {step.dependencies?.length ? step.dependencies.join(", ") : "none"}</p></div>
        <WorkflowStatusBadge status={step.status} />
      </div>
      <div className="mt-3 grid gap-2 text-[10px] text-muted-foreground sm:grid-cols-2">
        <span>Started: <strong className="font-normal text-foreground">{formatTimestamp(step.startedAt)}</strong></span>
        <span>Finished: <strong className="font-normal text-foreground">{formatTimestamp(step.finishedAt)}</strong></span>
      </div>
      {step.errorSummary && <p className="mt-3 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{step.errorSummary}</p>}
      {step.output !== undefined && <pre className="mt-3 max-h-48 overflow-auto rounded border border-border bg-muted/30 p-2 font-mono text-[10px] text-foreground whitespace-pre-wrap">{formatJson(step.output)}</pre>}
    </li>
  );
}

export default function WorkflowRunDetail({ run, onBack }: { run: WorkflowRun; onBack: () => void }) {
  const [currentRun, setCurrentRun] = useState(run);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const cursorRef = useRef(0);
  const currentRunRef = useRef(run);
  const pollInFlightRef = useRef(false);
  const pollNowRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    cursorRef.current = 0;
    currentRunRef.current = run;
    setCurrentRun(run);
    setEvents([]);
    setEventsError(null);
    setRunError(null);
    setEventsLoading(true);

    const schedule = (status: WorkflowRunStatus) => {
      if (!mounted || controller.signal.aborted || isTerminalStatus(status) || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void poll();
      }, WORKFLOW_RUN_POLL_INTERVAL_MS);
    };

    const poll = async () => {
      if (!mounted || controller.signal.aborted || pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      setRefreshing(true);
      setEventsLoading(true);
      setEventsError(null);
      setRunError(null);

      const eventRequest = listWorkflowEvents(run.id, {
        after: cursorRef.current,
        limit: WORKFLOW_RUN_EVENT_LIMIT,
        signal: controller.signal,
      });
      const runRequest = getWorkflowRun(run.id, controller.signal);
      const [eventResult, runResult] = await Promise.allSettled([eventRequest, runRequest]);

      if (!mounted || controller.signal.aborted) return;

      if (eventResult.status === "fulfilled") {
        const receivedEvents = eventResult.value.data ?? [];
        if (receivedEvents.length > 0) {
          const highestSequence = receivedEvents.reduce((highest, event) => Math.max(highest, event.sequence), cursorRef.current);
          cursorRef.current = highestSequence;
          setEvents((existingEvents) => {
            const bySequence = new Map(existingEvents.map((event) => [event.sequence, event]));
            receivedEvents.forEach((event) => {
              if (!bySequence.has(event.sequence)) bySequence.set(event.sequence, event);
            });
            return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
          });
        }
      } else if (!isAbortError(eventResult.reason)) {
        setEventsError(errorMessage(eventResult.reason));
      }

      const nextRun = runResult.status === "fulfilled" ? runResult.value : currentRunRef.current;
      if (runResult.status === "fulfilled") {
        currentRunRef.current = runResult.value;
        setCurrentRun(runResult.value);
      } else if (!isAbortError(runResult.reason)) {
        setRunError(errorMessage(runResult.reason));
      }

      pollInFlightRef.current = false;
      setEventsLoading(false);
      setRefreshing(false);
      schedule(nextRun.status);
    };

    pollNowRef.current = poll;
    void poll();

    return () => {
      mounted = false;
      controller.abort();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pollInFlightRef.current = false;
      if (pollNowRef.current === poll) pollNowRef.current = null;
    };
  }, [run]);

  const refresh = useCallback(() => {
    void pollNowRef.current?.();
  }, []);

  const isQueued = currentRun.status === "queued";
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto" aria-labelledby="workflow-run-title">
      <div className="border-b border-border px-4 py-4">
        <Button type="button" variant="ghost" size="sm" className="-ml-2 mb-3 h-7 text-xs" onClick={onBack}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Back to runs</Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Workflow run</p><h1 id="workflow-run-title" className="mt-1 font-mono text-sm font-semibold text-foreground">{currentRun.id}</h1><p className="mt-1 text-[11px] text-muted-foreground">Definition {currentRun.definitionId} · version {currentRun.version}</p></div>
          <WorkflowStatusBadge status={currentRun.status} />
        </div>
        {isQueued && <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-foreground" role="status" aria-live="polite">A queued workflow run was created. Workflow execution is not available through the current public API.</div>}
      </div>
      <div className="space-y-4 p-4">
         <div className="grid gap-2 text-[10px] text-muted-foreground sm:grid-cols-3"><span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Created {formatTimestamp(currentRun.createdAt)}</span><span>Updated {formatTimestamp(currentRun.updatedAt)}</span><span>Revision {currentRun.revision} · Event cursor {cursorRef.current}</span></div>
         {currentRun.errorSummary && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" role="alert">{currentRun.errorSummary}</div>}
         {runError && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" role="alert">Could not refresh workflow run: {runError}</div>}
         <section aria-labelledby="workflow-run-steps-title"><h2 id="workflow-run-steps-title" className="mb-2 text-sm font-semibold">Persisted steps</h2><ol className="space-y-2">{currentRun.steps.map((step) => <StepCard key={step.id} step={step} />)}</ol></section>
         <section aria-labelledby="workflow-run-events-title">
           <div className="mb-2 flex items-center justify-between gap-2">
             <div><h2 id="workflow-run-events-title" className="text-sm font-semibold">Persisted events</h2><p className="text-[10px] text-muted-foreground">Read-only event history, ordered by sequence</p></div>
             <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={refresh} disabled={refreshing || eventsLoading} aria-label="Refresh workflow events">
               <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />Refresh
             </Button>
           </div>
           {eventsLoading && events.length === 0 && <div className="h-16 animate-pulse rounded-md bg-muted/50" role="status"><span className="sr-only">Loading workflow events</span></div>}
           {eventsError && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" role="alert">Could not load workflow events: {eventsError}</div>}
           {!eventsLoading && !eventsError && events.length === 0 && <p className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">No persisted events yet.</p>}
           {events.length > 0 && <ol className="space-y-2" aria-label="Workflow run events">{events.map((event) => <EventCard key={event.sequence} event={event} />)}</ol>}
         </section>
       </div>
    </section>
  );
}
