export type LogLevel = "ALL" | "INFO" | "DEBUG" | "WARN" | "ERROR";
export type LogEntryLevel = "INFO" | "DEBUG" | "WARN" | "ERROR";
export type ConnectionStatus = "connected" | "connecting" | "disconnected";

export type LogEntry = {
  id: string;
  timestamp: string;
  level: LogEntryLevel;
  source: string;
  message: string;
};

export type EndpointDef = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  description: string;
  testable: boolean;
};

/** Exposed to external API consumers — OpenAI-compatible surface */
export const PUBLIC_ENDPOINTS: EndpointDef[] = [
  { method: "GET",  path: "/v1/models",           description: "List available models",      testable: true  },
  { method: "POST", path: "/v1/chat/completions", description: "Create chat completion",     testable: false },
  { method: "POST", path: "/v1/completions",      description: "Create completion",          testable: false },
  { method: "POST", path: "/v1/embeddings",       description: "Create embeddings",          testable: false },
];

/** Internal engine control — not part of the public API surface */
export const INTERNAL_ENDPOINTS: EndpointDef[] = [
  { method: "GET",  path: "/v1/models/available", description: "Scan disk for .gguf files",  testable: true  },
  { method: "GET",  path: "/v1/system/status",    description: "Engine status",              testable: true  },
  { method: "GET",  path: "/v1/config",           description: "Get server config",          testable: true  },
  { method: "POST", path: "/v1/config",           description: "Update server config",       testable: false },
  { method: "POST", path: "/v1/models/load",      description: "Load a model by path",       testable: false },
  { method: "POST", path: "/v1/models/unload",    description: "Unload current model",       testable: false },
  { method: "GET",  path: "/v1/system/hardware",  description: "Hardware info",              testable: true  },
  { method: "GET",  path: "/v1/system/usage",     description: "CPU/GPU/RAM usage",          testable: true  },
  { method: "GET",  path: "/v1/system/backends",  description: "List available backends",    testable: true  },
];

export function levelColor(level: string) {
  switch (level) {
    case "INFO":  return "text-status-online";
    case "DEBUG": return "text-muted-foreground";
    case "WARN":  return "text-status-downloading";
    case "ERROR": return "text-destructive";
    default:      return "text-foreground";
  }
}

export function levelBg(level: string) {
  switch (level) {
    case "INFO":  return "bg-status-online/10 text-status-online border-status-online/20";
    case "DEBUG": return "bg-muted/50 text-muted-foreground border-border";
    case "WARN":  return "bg-status-downloading/10 text-status-downloading border-status-downloading/20";
    case "ERROR": return "bg-destructive/10 text-destructive border-destructive/20";
    default:      return "bg-muted text-foreground border-border";
  }
}

export function formatUptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function formatTimestamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
