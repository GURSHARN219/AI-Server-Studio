import { useState, useEffect, useRef, useCallback } from "react";
import { type FetchedModel } from "@/lib/api";
import {
  type LogEntry, type LogEntryLevel, type ConnectionStatus,
  formatTimestamp,
} from "./types";

export function useServerState(serverPort: string) {
  const serverUrl = `http://127.0.0.1:${serverPort}`;

  const [isRunning, setIsRunning]         = useState(true);
  const [logs, setLogs]                   = useState<LogEntry[]>([]);
  const [isPaused, setIsPaused]           = useState(false);
  const [wsStatus, setWsStatus]           = useState<ConnectionStatus>("disconnected");
  const [uptime, setUptime]               = useState(0);
  const [loadedModels, setLoadedModels]   = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [endpointTestResult, setEndpointTestResult] = useState<{ path: string; status: string; time: number } | null>(null);
  const [requestCount, setRequestCount]   = useState(0);
  const [latency, setLatency]             = useState(0);

  const logIdRef      = useRef(1);
  const wsMsgCountRef = useRef(0);
  const isRunningRef  = useRef(isRunning);
  const wsStatusRef   = useRef(wsStatus);
  isRunningRef.current = isRunning;
  wsStatusRef.current  = wsStatus;

  const addLog = useCallback((level: LogEntryLevel, source: string, message: string) => {
    const entry: LogEntry = {
      id: String(logIdRef.current++),
      timestamp: formatTimestamp(new Date()),
      level, source, message,
    };
    setLogs(prev => {
      const next = [...prev, entry];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  const fetchModels = useCallback(async () => {
    setIsFetchingModels(true);
    const start = performance.now();
    try {
      const res = await fetch(`${serverUrl}/v1/system/status`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        setLatency(Math.round(performance.now() - start));
        if (data.loaded) {
          const id = data.modelName || data.model || "local-model";
          setLoadedModels([{ id, object: "model", owned_by: "local" }]);
        } else {
          setLoadedModels([]);
        }
      } else {
        setLoadedModels([]);
      }
    } catch {
      setLoadedModels([]);
    }
    setIsFetchingModels(false);
  }, [serverUrl]);

  // SSE event stream from engine — replaces polling when available.
  // Falls back to HTTP polling if the engine doesn't support /v1/events.
  const sseRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks whether the SSE connection ever successfully opened.
  // Used to distinguish "server doesn't support SSE" from "SSE dropped after connect".
  const sseEverOpenedRef = useRef(false);

  const pollStatus = useCallback(async () => {
    if (!isRunningRef.current) return;
    const start = performance.now();
    try {
      const res = await fetch(`${serverUrl}/v1/system/status`, { signal: AbortSignal.timeout(1500) });
      const ms = Math.round(performance.now() - start);
      setLatency(ms);
      if (res.ok) {
        if (wsStatusRef.current !== "connected") {
          setWsStatus("connected");
          addLog("INFO", "ENGINE", `Connected to ${serverUrl} (${ms}ms)`);
        }
        const data = await res.json();
        if (data.loaded) {
          const id = data.modelName || data.model || "local-model";
          setLoadedModels(prev => (prev.length === 1 && prev[0].id === id ? prev : [{ id, object: "model", owned_by: "local" }]));
        } else {
          setLoadedModels([]);
        }
      } else {
        if (wsStatusRef.current !== "disconnected") {
          setWsStatus("disconnected");
          addLog("WARN", "ENGINE", `Engine returned ${res.status}`);
        }
      }
    } catch {
      if (wsStatusRef.current !== "disconnected") {
        setWsStatus("disconnected");
        addLog("WARN", "ENGINE", `Cannot reach ${serverUrl}`);
      }
    }
  }, [serverUrl, addLog]);

  useEffect(() => {
    if (!isRunning) {
      setWsStatus("disconnected");
      sseRef.current?.close();
      sseRef.current = null;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    sseEverOpenedRef.current = false;

    const es = new EventSource(`${serverUrl}/v1/events`);
    sseRef.current = es;

    es.onopen = () => {
      sseEverOpenedRef.current = true;
      // SSE connected — cancel any fallback poll that may have started
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };

    es.onmessage = (e) => {
      // Ignore SSE comment heartbeats (they don't fire onmessage, but guard anyway)
      if (!e.data || e.data.startsWith(":")) return;
      try {
        const event = JSON.parse(e.data);
        if (event.type === "status") {
          if (wsStatusRef.current !== "connected") {
            setWsStatus("connected");
            addLog("INFO", "ENGINE", `Connected via SSE to ${serverUrl}`);
          }
          if (event.loaded) {
            const id = event.modelName || "local-model";
            setLoadedModels(prev => (prev.length === 1 && prev[0].id === id ? prev : [{ id, object: "model", owned_by: "local" }]));
          } else {
            setLoadedModels([]);
          }
        }
      } catch { /* ignore malformed events */ }
    };

    es.onerror = () => {
      if (!sseEverOpenedRef.current) {
        // Never connected — engine doesn't support SSE yet, fall back to polling
        es.close();
        sseRef.current = null;
        if (!pollRef.current) {
          pollStatus();
          pollRef.current = setInterval(pollStatus, 3000);
        }
      } else {
        // Was connected, now dropped — EventSource will auto-reconnect.
        // Just update UI state so the user sees the disconnection.
        if (wsStatusRef.current !== "disconnected") {
          setWsStatus("disconnected");
          addLog("WARN", "ENGINE", `SSE stream lost, reconnecting...`);
        }
      }
    };

    return () => {
      es.close();
      sseRef.current = null;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [isRunning, serverUrl, pollStatus, addLog]);

  // Uptime counter
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setUptime(p => p + 1), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const testEndpoint = useCallback(async (method: string, path: string) => {
    const start = performance.now();
    try {
      const resp = await fetch(`${serverUrl}${path}`, { method });
      const time = Math.round(performance.now() - start);
      const status = `${resp.status} ${resp.statusText}`;
      setEndpointTestResult({ path, status, time });
      setRequestCount(c => c + 1);
      addLog("INFO", "TEST", `${method} ${path} → ${resp.status} (${time}ms)`);
      if (path === "/v1/models" && resp.ok) {
        const data = await resp.json();
        setLoadedModels(data.data || data || []);
      }
    } catch {
      const time = Math.round(performance.now() - start);
      setEndpointTestResult({ path, status: "Connection refused", time });
      addLog("ERROR", "TEST", `${method} ${path} → Connection refused`);
    }
  }, [serverUrl, addLog]);

  const toggleServer = useCallback(() => {
    setIsRunning(r => {
      addLog("INFO", "SYSTEM", r ? "Server stopped by user" : "Server started by user");
      if (r) setWsStatus("disconnected");
      return !r;
    });
  }, [addLog]);

  return {
    serverUrl,
    isRunning, toggleServer,
    logs, setLogs, isPaused, setIsPaused,
    wsStatus, uptime, wsMsgCountRef,
    loadedModels, isFetchingModels, fetchModels,
    endpointTestResult, setEndpointTestResult,
    requestCount, latency,
    addLog, testEndpoint,
  };
}
