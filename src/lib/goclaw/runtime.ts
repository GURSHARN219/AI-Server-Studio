const GOCLAW_PORT_KEY = "goclaw:port";
const GOCLAW_DEFAULT_PORT = 18790;

export function getGoClawPort(): number {
  const raw = localStorage.getItem(GOCLAW_PORT_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return GOCLAW_DEFAULT_PORT;
}

export function setGoClawPort(port: number): void {
  if (!Number.isFinite(port) || port <= 0) return;
  localStorage.setItem(GOCLAW_PORT_KEY, String(port));
}

export function getGoClawHttpBaseUrl(): string {
  return `http://127.0.0.1:${getGoClawPort()}`;
}

export function getGoClawWsUrl(): string {
  return `ws://127.0.0.1:${getGoClawPort()}/ws`;
}
