import { getEnginePort } from "@/lib/localEngine";

import { authHeaders } from "@/api/auth";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function engineApiBase(): string {
  return `http://localhost:${getEnginePort()}/v1`;
}

export async function engineFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const base = new URL(engineApiBase());
  // Never forward a session bearer to an external host, port, or redirect target.
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  const isEngine = url.protocol === base.protocol && url.port === base.port && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.startsWith("/v1/");
  if (!isEngine) {
    headers.delete("Authorization");
    return globalThis.fetch(input, { ...init, headers });
  }
  Object.entries(authHeaders()).forEach(([key, value]) => { if (!headers.has(key)) headers.set(key, value); });
  if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return globalThis.fetch(input, { ...init, headers, redirect: "error" });
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Local API path required");
  const headers = new Headers(init.headers);
  Object.entries(authHeaders()).forEach(([key, value]) => { if (!headers.has(key)) headers.set(key, value); });
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const request: RequestInit = { ...init };
  if (headers.keys().next().done === false) request.headers = headers;
  const response = await engineFetch(`${engineApiBase()}${path}`, request);
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body
      ? String(typeof (body as { error: unknown }).error === "string" ? (body as { error: string }).error : (body as { error?: { message?: string } }).error?.message || response.statusText)
      : response.statusText || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}
