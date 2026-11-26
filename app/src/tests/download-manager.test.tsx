import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDownloadManager } from "@/hooks/useDownloadManager";
import { setEnginePort } from "@/lib/localEngine";

const fetchMock = vi.fn();

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("backend-owned download manager", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
    localStorage.setItem("ai-server-auth-token", "test-session");
    setEnginePort(1234);
    fetchMock.mockResolvedValue(response({ data: [] }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("does not fall back to a browser download or report success when the backend rejects the task", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(response({ error: { message: "digest required" } }, 400));

    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.startDownload({
        id: "org/model::model.gguf",
        modelId: "org/model",
        filename: "model.gguf",
        displayName: "Model",
        url: "https://huggingface.co/org/model/resolve/main/model.gguf",
        destDir: "C:/models",
        expectedSha256: "a".repeat(64),
      });
    });

    const item = result.current.downloads.find(download => download.id === "org/model::model.gguf");
    expect(item?.status).toBe("error");
    expect(item?.error).toContain("digest required");
    expect(fetchMock.mock.calls.some(([url]) => url === "https://huggingface.co/org/model/resolve/main/model.gguf")).toBe(false);
  });

  it("uses the stable backend task id for polling and cancellation", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ data: [] }))
      .mockResolvedValueOnce(response({ task_id: "task-1" }))
      .mockResolvedValueOnce(response({ status: "downloading", progress: 0.25, bytes_received: 25, total_bytes: 100, speed_bps: 10 }))
      .mockResolvedValueOnce(response({ status: "completed", progress: 1, bytes_received: 100, total_bytes: 100, speed_bps: 0 }));

    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.startDownload({
        id: "org/model::model.gguf",
        modelId: "org/model",
        filename: "model.gguf",
        displayName: "Model",
        url: "https://huggingface.co/org/model/resolve/main/model.gguf",
        destDir: "C:/models",
        expectedSha256: "b".repeat(64),
      });
    });

    expect(fetchMock.mock.calls.some(([url]) => url === "http://localhost:3000/v1/tasks/task-1")).toBe(true);
    expect(result.current.downloads.find(download => download.id === "org/model::model.gguf")?.status).toBe("done");
  });
});
