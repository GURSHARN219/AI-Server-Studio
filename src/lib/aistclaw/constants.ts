export const AISTCLAW_BASE_PATH = "/aistclaw";

function buildAistclawRoute(path: string): string {
  return `${AISTCLAW_BASE_PATH}${path ? `/${path}` : ""}`;
}

export const AISTCLAW_ROUTE_PATHS = {
  LOGIN: "login",
  OVERVIEW: "overview",
  CHAT: "chat",
  CHAT_PATTERN: "chat/:sessionKey?",
  AGENTS: "agents",
  AGENT_DETAIL: "agents/:id",
  AGENT_CODEX_POOL: "agents/:id/codex-pool",
  IMPORT_EXPORT: "import-export",
  SESSIONS: "sessions",
  SESSION_DETAIL: "sessions/:key",
  SKILLS: "skills",
  SKILL_DETAIL: "skills/:id",
  CRON: "cron",
  CRON_DETAIL: "cron/:id",
  CONFIG: "config",
  TRACES: "traces",
  TRACE_DETAIL: "traces/:id",
  EVENTS: "events",
  USAGE: "usage",
  CHANNELS: "channels",
  CHANNEL_DETAIL: "channels/:id",
  CONTACTS: "contacts",
  APPROVALS: "approvals",
  NODES: "nodes",
  LOGS: "logs",
  PROVIDERS: "providers",
  PROVIDER_DETAIL: "providers/:id",
  TEAMS: "teams",
  TEAM_DETAIL: "teams/:id",
  BUILTIN_TOOLS: "builtin-tools",
  CLI_CREDENTIALS: "cli-credentials",
  MCP: "mcp",
  TTS: "tts",
  STORAGE: "storage",
  PENDING_MESSAGES: "pending-messages",
  MEMORY: "memory",
  KNOWLEDGE_GRAPH: "knowledge-graph",
  ACTIVITY: "activity",
  API_KEYS: "api-keys",
  PACKAGES: "packages",
  TENANTS: "admin/tenants",
  TENANT_DETAIL: "admin/tenants/:id",
  SETUP: "setup",
  SELECT_TENANT: "select-tenant",
} as const;

export const ROUTES = {
  ROOT: AISTCLAW_BASE_PATH,
  LOGIN: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.LOGIN),
  OVERVIEW: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.OVERVIEW),
  CHAT: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.CHAT),
  CHAT_PATTERN: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.CHAT_PATTERN),
  AGENTS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.AGENTS),
  AGENT_DETAIL: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.AGENT_DETAIL),
  AGENT_CODEX_POOL: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.AGENT_CODEX_POOL),
  IMPORT_EXPORT: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.IMPORT_EXPORT),
  SESSIONS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.SESSIONS),
  SESSION_DETAIL: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.SESSION_DETAIL),
  SKILLS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.SKILLS),
  SKILL_DETAIL: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.SKILL_DETAIL),
  CRON: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.CRON),
  CRON_DETAIL: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.CRON_DETAIL),
  CONFIG: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.CONFIG),
  TRACES: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.TRACES),
  TRACE_DETAIL: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.TRACE_DETAIL),
  EVENTS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.EVENTS),
  USAGE: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.USAGE),
  CHANNELS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.CHANNELS),
  CHANNEL_DETAIL: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.CHANNEL_DETAIL),
  CONTACTS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.CONTACTS),
  APPROVALS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.APPROVALS),
  NODES: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.NODES),
  LOGS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.LOGS),
  PROVIDERS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.PROVIDERS),
  PROVIDER_DETAIL: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.PROVIDER_DETAIL),
  TEAMS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.TEAMS),
  TEAM_DETAIL: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.TEAM_DETAIL),
  BUILTIN_TOOLS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.BUILTIN_TOOLS),
  CLI_CREDENTIALS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.CLI_CREDENTIALS),
  MCP: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.MCP),
  TTS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.TTS),
  STORAGE: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.STORAGE),
  PENDING_MESSAGES: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.PENDING_MESSAGES),
  MEMORY: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.MEMORY),
  KNOWLEDGE_GRAPH: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.KNOWLEDGE_GRAPH),
  ACTIVITY: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.ACTIVITY),
  API_KEYS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.API_KEYS),
  PACKAGES: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.PACKAGES),
  TENANTS: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.TENANTS),
  TENANT_DETAIL: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.TENANT_DETAIL),
  SETUP: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.SETUP),
  SELECT_TENANT: buildAistclawRoute(AISTCLAW_ROUTE_PATHS.SELECT_TENANT),
} as const;

export const LOCAL_STORAGE_KEYS = {
  TOKEN: "aistclaw:token",
  USER_ID: "aistclaw:userId",
  SENDER_ID: "aistclaw:senderID",
  TENANT_ID: "aistclaw:tenant_id",
  TENANT_HINT: "aistclaw:tenant_hint",
  SETUP_SKIPPED: "aistclaw:setup_skipped",
  THEME: "aistclaw:theme",
  SIDEBAR_COLLAPSED: "aistclaw:sidebarCollapsed",
  LANGUAGE: "aistclaw:language",
  TIMEZONE: "aistclaw:timezone",
} as const;

export const SUPPORTED_LANGUAGES = ["en", "vi", "zh"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  vi: "Tiếng Việt",
  zh: "中文",
};

/** "auto" = browser's local timezone. */
export const TIMEZONE_OPTIONS = [
  { value: "auto", label: "Auto (Local)" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "America/Chicago", label: "Chicago (CT)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PT)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (CET)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Shanghai (CST)" },
  { value: "Asia/Ho_Chi_Minh", label: "Ho Chi Minh (ICT)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
] as const;

/** Compute UTC offset string for a timezone, e.g. "UTC+7", "UTC-5:30" */
function formatUtcOffset(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date());
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return raw.replace("GMT", "UTC").replace(/^UTC$/, "UTC+0");
}

function parseOffsetMinutes(offset: string): number {
  const m = offset.match(/UTC([+-]?)(\d+)(?::(\d+))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2]!, 10) * 60 + parseInt(m[3] ?? "0", 10));
}

type TzOption = { value: string; label: string };
let _cachedTimezones: TzOption[] | undefined;

/** Minimal fallback when Intl.supportedValuesOf is unavailable. */
const FALLBACK_TIMEZONES: string[] = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Halifax", "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Europe/Moscow", "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Ho_Chi_Minh",
  "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Asia/Singapore", "Australia/Sydney",
  "Pacific/Auckland",
];

/** All IANA timezones with dynamic UTC offsets, sorted by offset then name. */
export function getAllIanaTimezones(): TzOption[] {
  if (_cachedTimezones) return _cachedTimezones;
  let tzNames: string[];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tzNames = (Intl as any).supportedValuesOf("timeZone") as string[];
  } catch {
    tzNames = FALLBACK_TIMEZONES;
  }
  // Chrome may omit "UTC" from the list
  if (!tzNames.includes("UTC")) tzNames = ["UTC", ...tzNames];
  const entries = tzNames.map((tz: string) => {
    const offset = formatUtcOffset(tz);
    return { value: tz, label: `${tz} (${offset})`, _offset: parseOffsetMinutes(offset) };
  });
  entries.sort((a: { _offset: number; value: string }, b: { _offset: number; value: string }) =>
    a._offset !== b._offset ? a._offset - b._offset : a.value.localeCompare(b.value),
  );
  _cachedTimezones = entries.map(({ value, label }: { value: string; label: string }) => ({ value, label }));
  return _cachedTimezones;
}

let _cachedTzSet: Set<string> | undefined;

/** Check if a value is a valid IANA timezone from the dynamic list. */
export function isValidIanaTimezone(tz: string): boolean {
  if (!_cachedTzSet) {
    _cachedTzSet = new Set(getAllIanaTimezones().map((t) => t.value));
  }
  return _cachedTzSet.has(tz);
}
