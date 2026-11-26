import { describe, expect, it } from "vitest";
import { readSSE } from "@/api/sse";

function response(chunks: Uint8Array[]) {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } }));
}
describe("incremental SSE parsing", () => {
  it("handles split UTF-8, CRLF, comments, ids and multi-line data", async () => {
    const bytes = new TextEncoder().encode(": heartbeat\r\nid: 12\r\nevent: update\r\ndata: héllo\r\ndata: world\r\n\r\n");
    const messages: unknown[] = [];
    await readSSE(response(Array.from(bytes, byte => new Uint8Array([byte]))), message => messages.push(message));
    expect(messages).toEqual([{ data: "héllo\nworld", lastEventId: "12", event: "update" }]);
  });
  it("does not dispatch incomplete events at EOF", async () => {
    const messages: unknown[] = [];
    await readSSE(response([new TextEncoder().encode("data: partial\n")]), message => messages.push(message));
    expect(messages).toEqual([]);
  });
  it("retains ids across events and ignores invalid NUL ids", async () => {
    const messages: unknown[] = [];
    await readSSE(response([new TextEncoder().encode("id: 1\ndata: first\n\nid: bad\0id\ndata:second\n\n")]), message => messages.push(message));
    expect(messages).toEqual([{ data: "first", lastEventId: "1", event: "message" }, { data: "second", lastEventId: "1", event: "message" }]);
  });
  it("cancels a reader waiting for data", async () => {
    let cancelled = false;
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const reading = readSSE(new Response(body), () => {}, controller.signal);
    controller.abort();
    await reading;
    expect(cancelled).toBe(true);
  });
});
