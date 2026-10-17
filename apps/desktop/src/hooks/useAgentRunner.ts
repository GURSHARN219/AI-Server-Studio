import { useState, useRef, useCallback, useEffect } from "react";
import type { AgentEvent, AgentRunEvent, AgentResult, AgentRunnerConfig, TaskPlan, TaskStep } from "@/features/agents";
import { agentRunEventsUrl, cancelAgentRun, createAgentRun, getAgentRun } from "@/api/agents";
import { streamEngineEvents } from "@/api/sse";
import { ApiError } from "@/api/client";
import { getAuthToken } from "@/api/auth";

type AgentStatus = "idle" | "planning" | "running" | "done" | "error";

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 8000;

export interface UseAgentRunnerReturn {
  status: AgentStatus;
  events: AgentEvent[];
  result: AgentResult | null;
  error: string | null;
  startAgent: (goal: string, config: Omit<AgentRunnerConfig, "onEvent">) => void;
  abortAgent: () => void;
}

function mapEvent(evt: AgentRunEvent): AgentEvent | null {
    switch (evt.type) {
      case "plan_created":
        return { type: "plan_created", plan: (evt.data?.plan as TaskPlan | undefined) || {
          goal: "",
          createdAt: Date.now(),
          steps: [],
        }} as AgentEvent;
      case "step_started":
        return { type: "step_started", step: (evt.data?.step as TaskStep | undefined) || {
          id: "step",
          description: "Running",
          status: "running",
        }} as AgentEvent;
      case "step_observation":
        return {
          type: "step_observation",
          stepId: String(evt.data?.stepId || ""),
          toolName: String(evt.data?.toolName || ""),
          observation: String(evt.data?.observation || ""),
        };
      case "step_done":
        return {
          type: "step_done",
          stepId: String(evt.data?.stepId || ""),
          answer: String(evt.data?.answer || ""),
        };
      case "agent_done":
        return { type: "agent_done", answer: String(evt.data?.answer || "") };
      case "agent_error":
        return { type: "agent_error", reason: String(evt.data?.reason || "Unknown error") };
      default:
        return null;
    }
}

export function useAgentRunner(): UseAgentRunnerReturn {
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const runTokenRef = useRef("");
  const eventSourceRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const lastSequenceRef = useRef(0);

  const closeEventStream = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.abort();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    generationRef.current += 1;
    closeEventStream();
  }, [closeEventStream]);
  useEffect(() => {
    const changed = () => {
      generationRef.current += 1;
      closeEventStream();
      if (runIdRef.current) void cancelAgentRun(runIdRef.current, runTokenRef.current).catch(() => {});
      runIdRef.current = null;
      setStatus("idle"); setEvents([]); setResult(null); setError(null);
    };
    window.addEventListener("account:changed", changed);
    return () => window.removeEventListener("account:changed", changed);
  }, [closeEventStream]);

  const fetchRunResult = useCallback(async (runId: string, generation: number): Promise<void> => {
    try {
      const data = await getAgentRun(runId, AbortSignal.timeout(3000));
      if (generationRef.current !== generation) return;

      const plan = (data.plan as TaskPlan | undefined) || { goal: data.goal || "", steps: [], createdAt: Date.now() };
      const resultObj: AgentResult = {
        answer: data.result || "",
        plan,
        totalTokensUsed: Number(data.totalTokens || 0),
        iterations: Number(data.iterations || 0),
      };
      setResult(resultObj);
    } catch {
      // best-effort only
    }
  }, []);

  const startAgent = useCallback((goal: string, config: Omit<AgentRunnerConfig, "onEvent">) => {
    void (async () => {
      closeEventStream();
      const generation = ++generationRef.current;
      const runToken = getAuthToken();
      runTokenRef.current = runToken;
      runIdRef.current = null;
      lastSequenceRef.current = 0;

      setEvents([]);
      setResult(null);
      setError(null);
      setStatus("planning");

      try {
        const created = await createAgentRun({
            goal,
            modelName: config.modelName,
            maxSteps: config.maxStepsPerGoal || 10,
            maxIterations: config.maxIterations || 20,
            provider: {
              id: config.provider.id,
            },
            tools: config.tools,
            executionMode: config.executionMode,
        });
        const runId = String(created.id || "");
        if (!runId) throw new Error("Invalid backend run id");
        if (generationRef.current !== generation) {
          // Cancellation can arrive while the create request is still in flight.
          void cancelAgentRun(runId, runToken).catch(() => {});
          return;
        }
        runIdRef.current = runId;

        let reconnectAttempts = 0;
        let terminal = false;
        const isCurrentRun = () => generationRef.current === generation && !terminal;

        const reconnect = () => {
          if (!isCurrentRun()) return;
          // Disable native EventSource retry: each new connection carries our cursor.
          closeEventStream();
          if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            terminal = true;
            setStatus("error");
            setError("Agent event stream disconnected");
            return;
          }
          const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts, RECONNECT_MAX_DELAY_MS);
          reconnectAttempts += 1;
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, delay);
        };

        const connect = () => {
          if (!isCurrentRun()) return;
          const es = new AbortController();
          eventSourceRef.current = es;
          const onMessage = (event: { data: string; lastEventId: string }) => {
            if (!isCurrentRun() || eventSourceRef.current !== es || !event.data) return;
            try {
              const parsed = JSON.parse(event.data) as AgentRunEvent;
              if (!parsed || typeof parsed.type !== "string") return;
              const sequence = parsed.sequence ?? (event.lastEventId ? Number(event.lastEventId) : undefined);
              if (sequence !== undefined) {
                if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence <= lastSequenceRef.current) return;
                // Advance even for event types that this UI does not render.
                lastSequenceRef.current = sequence;
              }
              reconnectAttempts = 0;
              const mapped = mapEvent(parsed);
              if (!mapped) return;

              setEvents((prev) => [...prev, mapped]);

              if (mapped.type === "plan_created") setStatus("running");

              if (mapped.type === "agent_done") {
                terminal = true;
                setStatus("done");
                void fetchRunResult(runId, generation);
                closeEventStream();
              }

              if (mapped.type === "agent_error") {
                terminal = true;
                setStatus("error");
                setError(mapped.reason);
                closeEventStream();
              }
            } catch {
              // ignore malformed event
            }
          };

          void streamEngineEvents(agentRunEventsUrl(runId, lastSequenceRef.current), onMessage, es.signal)
            .then(() => { if (eventSourceRef.current === es && !es.signal.aborted) reconnect(); })
            .catch((err: unknown) => {
              if (eventSourceRef.current !== es || es.signal.aborted) return;
              if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
                terminal = true;
                setStatus("error");
                setError("Sign in again to resume this agent run.");
                closeEventStream();
              } else reconnect();
            });
        };
        connect();
      } catch (err) {
        if (generationRef.current !== generation) return;
        const message = err instanceof Error ? err.message : "Failed to start backend agent run";
        setStatus("error");
        setError(message);
      }
    })();

  }, [closeEventStream, fetchRunResult]);

  const abortAgent = useCallback(() => {
    generationRef.current += 1;
    const runId = runIdRef.current;
    runIdRef.current = null;
    if (runId) {
      void cancelAgentRun(runId, runTokenRef.current).catch(() => {});
    }
    closeEventStream();
    setStatus("idle");
  }, [closeEventStream]);

  return { status, events, result, error, startAgent, abortAgent };
}
