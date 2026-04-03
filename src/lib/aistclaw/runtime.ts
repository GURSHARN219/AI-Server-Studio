const AISTCLAW_PORT_KEY = "aistclaw:port";
const AISTCLAW_DEFAULT_PORT = 18790;

export function getAistclawPort(): number {
  const raw = localStorage.getItem(AISTCLAW_PORT_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return AISTCLAW_DEFAULT_PORT;
}

export function setAistclawPort(port: number): void {
  if (!Number.isFinite(port) || port <= 0) return;
  localStorage.setItem(AISTCLAW_PORT_KEY, String(port));
}

export function getAistclawHttpBaseUrl(): string {
  return `http://127.0.0.1:${getAistclawPort()}`;
}

export function getAistclawWsUrl(): string {
  return `ws://127.0.0.1:${getAistclawPort()}/ws`;
}
