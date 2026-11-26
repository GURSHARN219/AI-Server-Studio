import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendChatCompletionStreaming } from "@/lib/api";
import type { ApiProvider } from "@/types";

const localProvider: ApiProvider = {
  id: "local",
  name: "Local Server",
  baseUrl: "http://127.0.0.1:8080/v1",
  apiKey: "",
  enabled: true,
};

function makeSSEResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("Streaming tokens and reasoning_content", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("streams delta.reasoning_content wrapped in <think> tags followed by delta.content", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"Let me "}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"think."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello!"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"timings":{"predicted_per_second":42.5}}\n\n',
      "data: [DONE]\n\n",
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeSSEResponse(sse));

    const tokens: string[] = [];
    const statsList: unknown[] = [];
    const result = await sendChatCompletionStreaming(
      localProvider,
      [{ role: "user", content: "hi" }],
      "Qwen3-4B-Thinking-2507-Q4_K_M.gguf",
      undefined,
      (token, stats) => {
        if (token) tokens.push(token);
        if (stats) statsList.push(stats);
      },
    );

    expect(tokens.join("")).toBe("<think>Let me think.</think>Hello!");
    expect(result).toBe("Hello!");
    expect(statsList).toEqual([{ timings: { predicted_per_second: 42.5 } }]);
  });

  it("closes <think> tag if stream ends after reasoning_content without content", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"reasoning":"Only thinking"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeSSEResponse(sse));

    const tokens: string[] = [];
    await sendChatCompletionStreaming(
      localProvider,
      [{ role: "user", content: "hi" }],
      "Qwen3-4B-Thinking-2507-Q4_K_M.gguf",
      undefined,
      (token) => {
        if (token) tokens.push(token);
      },
    );

    expect(tokens.join("")).toBe("<think>Only thinking</think>");
  });

  it("throws error when SSE chunk contains an error payload", async () => {
    const sse = ['data: {"error":{"message":"Model crashed","type":"engine_error"}}\n\n'];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeSSEResponse(sse));

    await expect(
      sendChatCompletionStreaming(localProvider, [{ role: "user", content: "hi" }], "local-model"),
    ).rejects.toThrow("Model crashed");
  });

});
