import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";

vi.mock("@/lib/localEngine", () => ({
  getEnginePort: () => 1234,
  engineBase: () => "http://localhost:3000/v1",
}));

type CapturedChatLogic = {
  selectedModel?: { name?: string; providerId?: string };
  input: string;
  setInput: (value: string) => void;
  handleSend: () => Promise<void>;
};

let latestChatLogic: CapturedChatLogic | null = null;

vi.mock("@/components/chat/ChatUI", () => ({
  ChatUI: (props: unknown) => {
    latestChatLogic = props as CapturedChatLogic;
    return null;
  },
}));

import ChatPage from "@/pages/ChatPage";
import {
  loadProviderModelPrefs,
  setProviderModelPref,
  type ModelCapability,
} from "@/lib/providerModelPrefs";
import type { ApiProvider, ToolItem } from "@/types";

describe("Saved model + toolcall flow", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    latestChatLogic = null;
  });

  it("uses app-saved OpenRouter model and auto-selects tools when sending input", async () => {

    // Saved via the same persistence module the Settings UI uses.
    // (ProvidersTab ultimately calls setProviderModelPref under the hood.)
    setProviderModelPref("provider-openrouter", {
      allowedModels: ["stepfun/step-3.5-flash:free"],
      defaultModel: "stepfun/step-3.5-flash:free",
      selections: [
        { modelId: "stepfun/step-3.5-flash:free", modelType: "chat" as ModelCapability },
      ],
    });

    const prefs = loadProviderModelPrefs();
    expect(prefs["provider-openrouter"].defaultModel).toBe("stepfun/step-3.5-flash:free");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      // Local model scan used by ChatPage/useChatLogic bootstrap.
      if (url.includes("/v1/models/available")) {
        return {
          ok: true,
          json: async () => ({ data: [] }),
        } as Response;
      }

      if (url.includes("/v1/agent/chat")) {
        // Sanity-check payload is OpenRouter + saved model + tools.
        const body = JSON.parse(String((init as RequestInit | undefined)?.body || "{}")) as {
          provider?: { id?: string; baseUrl?: string; apiKey?: string };
          modelName?: string;
          tools?: Array<{ function?: { name?: string } }>;
        };
        expect(body.provider).toEqual({ id: "provider-openrouter" });
        expect(body.modelName).toBe("stepfun/step-3.5-flash:free");
        expect(Array.isArray(body.tools)).toBe(true);
        expect(body.tools?.length || 0).toBeGreaterThan(0);
        expect((body.tools || []).some((t) => t.function?.name === "web-search")).toBe(true);

        return {
          ok: true,
          json: async () => ({
            content: "Tool execution completed",
            toolCalls: [
              {
                id: "call-1",
                name: "web-search",
                args: '{"query":"latest ai news"}',
                status: "done",
                result: "Found 3 results",
                duration: 120,
              },
            ],
          }),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        text: async () => `Unhandled mock URL: ${url}`,
      } as Response;
    });

    const providers: ApiProvider[] = [
      {
        id: "provider-openrouter",
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "",
        hasKey: true,
        enabled: true,
      },
    ];

    const tools: ToolItem[] = [
      { id: "web-search", name: "Web Search", source: "built-in", enabled: true, tagLabel: "web-search", tagColor: "text-status-downloading" },
      { id: "url-fetch", name: "URL Fetch", source: "built-in", enabled: true, tagLabel: "url-fetch", tagColor: "text-status-online" },
      { id: "knowledge-base", name: "Knowledge Base", source: "built-in", enabled: true, tagLabel: "knowledge-base", tagColor: "text-muted-foreground" },
    ];

    const props: ComponentProps<typeof ChatPage> = {
      tools,
      providers,
      onToggleTool: () => {},
      onModelSelect: () => {},
      onAddTool: () => {},
    };

    render(<ChatPage {...props} />);

    await waitFor(() => {
      expect(latestChatLogic).toBeTruthy();
      expect(latestChatLogic?.selectedModel?.name).toBe("stepfun/step-3.5-flash:free");
      expect(latestChatLogic?.selectedModel?.providerId).toBe("provider-openrouter");
    });

    // setInput triggers a rerender; wait until our ChatUI mock captures the updated props
    await act(async () => {
      latestChatLogic?.setInput("Do research and cite sources");
    });
    await waitFor(() => {
      expect(latestChatLogic?.input).toBe("Do research and cite sources");
    });
    await act(async () => {
      await latestChatLogic?.handleSend();
    });

    const agentCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/v1/agent/chat"));
    expect(agentCall).toBeTruthy();
  });
});
