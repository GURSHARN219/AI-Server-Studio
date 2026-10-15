import { ApiError, engineFetch } from "@/api/client";

export type SSEMessage = { data: string; lastEventId: string; event: string };

/** Incremental parser: CRLF, multi-line data, comments and split UTF-8 chunks. */
export async function readSSE(response: Response, onMessage: (message: SSEMessage) => void, signal?: AbortSignal): Promise<void> {
  if (!response.ok) throw new ApiError(`Event stream failed (${response.status})`, response.status);
  if (!response.body) throw new Error("Event stream has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let id = "";
  let event = "message";
  const line = (text: string) => {
    if (!text) {
      if (data.length) onMessage({ data: data.join("\n"), lastEventId: id, event });
      data = []; event = "message";
      return;
    }
    if (text.startsWith(":")) return;
    const separator = text.indexOf(":");
    const field = separator < 0 ? text : text.slice(0, separator);
    const value = separator < 0 ? "" : text.slice(separator + 1).replace(/^ /, "");
    if (field === "data") data.push(value);
    if (field === "id" && !value.includes("\0")) id = value;
    if (field === "event") event = value;
  };
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.search(/[\r\n]/)) >= 0) {
        if (!done && buffer[boundary] === "\r" && boundary === buffer.length - 1) break;
        line(buffer.slice(0, boundary));
        const width = buffer[boundary] === "\r" && buffer[boundary + 1] === "\n" ? 2 : 1;
        buffer = buffer.slice(boundary + width);
      }
      if (done) break;
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function streamEngineEvents(url: string, onMessage: (message: SSEMessage) => void, signal: AbortSignal): Promise<void> {
  const response = await engineFetch(url, { headers: { Accept: "text/event-stream" }, signal });
  await readSSE(response, onMessage, signal);
}
