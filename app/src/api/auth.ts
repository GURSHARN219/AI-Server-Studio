export const AUTH_TOKEN_STORAGE_KEY = "ai-server-auth-token";
export const DEMO_EMAIL = "demo@aiserver.studio";
export const DEMO_PASSWORD = "demo123";
export const DEMO_AUTH_TOKEN = "demo-ui-token";

export function getAuthToken(): string {
  try { return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || ""; } catch { return ""; }
}

export function isDemoAuthToken(token = getAuthToken()): boolean {
  return token === DEMO_AUTH_TOKEN;
}

export function authHeaders(withJSON = false): Record<string, string> {
  const token = getAuthToken();
  return { ...(withJSON ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export function setAuthToken(token: string): void {
  // Synchronous notification lets stores flush using the previous account's token.
  window.dispatchEvent(new Event("auth:changing"));
  if (token) localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.dispatchEvent(new Event("auth:changed"));
}
