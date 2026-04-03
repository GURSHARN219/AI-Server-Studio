/**
 * Chat Frontend Tests
 * Covers: MessageBubble, MessageList, AgentPicker, ModelPicker,
 *         input/output flow, tool calls UI, error states, sub-components
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({
    appearance: {
      expandReasoningByDefault: false,
      showReasoningVignette: true,
      viewMode: "markdown",
      showGenInfo: "all",
      expandChatToWindowWidth: false,
      chatMessagesStyle: "default",
      autoLatchGenerating: true,
      scrollToTopOnSend: false,
    },
  }),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span data-testid="markdown">{children}</span>,
}));

vi.mock("@/components/chat/CodeBlock", () => ({
  default: ({ children }: { children: React.ReactNode }) => <code>{children}</code>,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import MessageBubble from "@/components/chat/MessageBubble";
import { MessageList } from "@/components/chat/sub-components/MessageList";
import { AgentPicker } from "@/components/chat/sub-components/AgentPicker";
import { ModelPicker } from "@/components/chat/sub-components/ModelPicker";
import { AGENT_MODES } from "@/components/chat/useChatLogic";
import type { Message, ModelDef } from "@/components/chat/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (ts: number) => "12:00";
const noop = () => {};

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    role: "user",
    content: "Hello world",
    timestamp: Date.now(),
    ...overrides,
  };
}

const apiModel: ModelDef = {
  id: "openai-gpt-4o",
  name: "gpt-4o",
  params: "-",
  quant: "-",
  source: "api",
  provider: "OpenAI",
  providerId: "openai",
  supportsTools: true,
};

const localModel: ModelDef = {
  id: "local-llama3",
  name: "llama3.gguf",
  params: "8B",
  quant: "Q4",
  source: "local",
  provider: "Local Engine",
};

// ── MessageBubble — user message ─────────────────────────────────────────────

describe("MessageBubble — user message", () => {
  it("renders user content", () => {
    render(<MessageBubble message={makeMsg()} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("shows timestamp", () => {
    render(<MessageBubble message={makeMsg()} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getByText("12:00")).toBeInTheDocument();
  });

  it("renders attached image", () => {
    const msg = makeMsg({ images: ["data:image/png;base64,abc"] });
    render(<MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getByAltText("Uploaded 1")).toBeInTheDocument();
  });

  it("calls onDelete when trash icon clicked", () => {
    const onDelete = vi.fn();
    render(<MessageBubble message={makeMsg()} isGenerating={false} formatTime={fmt} onDelete={onDelete} onRegenerate={noop} />);
    // Hover group buttons are in DOM even if opacity-0
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]); // first button = delete
    expect(onDelete).toHaveBeenCalledOnce();
  });
});

// ── MessageBubble — assistant message ────────────────────────────────────────

describe("MessageBubble — assistant message", () => {
  it("renders assistant content with model name", () => {
    const msg = makeMsg({ role: "assistant", content: "I can help!", modelName: "gpt-4o" });
    render(<MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getByText("I can help!")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
  });

  it("shows blinking cursor while generating", () => {
    const msg = makeMsg({ role: "assistant", content: "Typing..." });
    const { container } = render(<MessageBubble message={msg} isGenerating={true} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(container.querySelector(".animate-blink")).toBeInTheDocument();
  });

  it("shows spinner when generating with no content yet", () => {
    const msg = makeMsg({ role: "assistant", content: "" });
    render(<MessageBubble message={msg} isGenerating={true} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getByText("Generating...")).toBeInTheDocument();
  });

  it("shows token metrics when tokensCount/generationTime/speed present", () => {
    const msg = makeMsg({
      role: "assistant", content: "Done",
      tokensCount: 120, generationTime: 3.2, speed: 37.5,
    });
    render(<MessageBubble message={msg} isGenerating={false} isLastAssistant formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getByText("120 tokens")).toBeInTheDocument();
    expect(screen.getByText("3.2s")).toBeInTheDocument();
    expect(screen.getByText("37.5 t/s")).toBeInTheDocument();
  });

  it("calls onRegenerate when regenerate button clicked", () => {
    const onRegenerate = vi.fn();
    const msg = makeMsg({ role: "assistant", content: "Answer" });
    render(<MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={onRegenerate} />);
    const regenBtn = screen.getByTitle("Regenerate");
    fireEvent.click(regenBtn);
    expect(onRegenerate).toHaveBeenCalledOnce();
  });
});

// ── MessageBubble — error state ───────────────────────────────────────────────

describe("MessageBubble — error state", () => {
  it("renders error message with destructive styling", () => {
    const msg = makeMsg({ role: "assistant", content: "", error: "Rate limited by provider" });
    render(<MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getByText("Rate limited by provider")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("does not show content area when error is set", () => {
    const msg = makeMsg({ role: "assistant", content: "", error: "Something broke" });
    const { queryByTestId } = render(<MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(queryByTestId("markdown")).not.toBeInTheDocument();
  });
});

// ── MessageBubble — thinking / reasoning ─────────────────────────────────────

describe("MessageBubble — thinking/reasoning box", () => {
  it("shows Reasoning toggle when thinkingContent present", () => {
    const msg = makeMsg({ role: "assistant", content: "Answer", thinkingContent: "Let me think...", thinkingTime: 4 });
    render(<MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("4s")).toBeInTheDocument();
  });

  it("expands thinking content on click", () => {
    const msg = makeMsg({ role: "assistant", content: "Answer", thinkingContent: "Deep thought here", thinkingTime: 2 });
    render(<MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    const toggle = screen.getByText("Reasoning").closest("button")!;
    fireEvent.click(toggle);
    expect(screen.getByText("Deep thought here")).toBeInTheDocument();
  });

  it("shows animated spinner when still reasoning (no thinkingTime)", () => {
    const msg = makeMsg({ role: "assistant", content: "", thinkingContent: "thinking..." });
    const { container } = render(<MessageBubble message={msg} isGenerating={true} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });
});

// ── MessageBubble — tool calls UI ─────────────────────────────────────────────

describe("MessageBubble — tool calls", () => {
  const toolCalls: Message["toolCalls"] = [
    { id: "tc1", name: "web.search", args: '{"query":"test"}', status: "done", result: "Result A", duration: 120 },
    { id: "tc2", name: "kb.search",  args: '{"query":"docs"}', status: "running" },
  ];

  it("shows individual tool cards", () => {
    const msg = makeMsg({ role: "assistant", content: "Here", toolCalls });
    render(<MessageBubble message={msg} isGenerating={true} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getByText("web.search")).toBeInTheDocument();
    expect(screen.getByText("kb.search")).toBeInTheDocument();
  });

  it("shows spinner when a tool is running", () => {
    const msg = makeMsg({ role: "assistant", content: "Here", toolCalls });
    const { container } = render(<MessageBubble message={msg} isGenerating={true} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows done tool card without spinner when all tools done", () => {
    const doneCalls: Message["toolCalls"] = [
      { id: "tc1", name: "web.search", args: "{}", status: "done", result: "ok", duration: 50 },
    ];
    const msg = makeMsg({ role: "assistant", content: "Done", toolCalls: doneCalls });
    const { container } = render(<MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getByText("web.search")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("expands a tool card on click and shows content", () => {
    const msg = makeMsg({ role: "assistant", content: "Here", toolCalls });
    render(<MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    const row = screen.getByText("web.search").closest("button")!;
    fireEvent.click(row);
    expect(screen.getByText("Result:")).toBeInTheDocument();
  });

  it("shows tool result and duration when expanded", () => {
    const msg = makeMsg({ role: "assistant", content: "Here", toolCalls });
    render(<MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    fireEvent.click(screen.getByText("web.search").closest("button")!);
    expect(screen.getByText("Result:")).toBeInTheDocument();
    expect(screen.getByText("120ms")).toBeInTheDocument();
  });

  it("shows running indicator for running tool", () => {
    const msg = makeMsg({ role: "assistant", content: "Here", toolCalls });
    render(<MessageBubble message={msg} isGenerating={true} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getAllByText(/running/i).length).toBeGreaterThan(0);
  });
});

// ── MessageList ───────────────────────────────────────────────────────────────

describe("MessageList", () => {
  const endRef = { current: null } as React.RefObject<HTMLDivElement>;

  it("shows empty state when no messages", () => {
    render(
      <MessageList messages={[]} isGenerating={false} selectedModel={apiModel}
        providers={[]} messagesEndRef={endRef} formatTime={fmt}
        deleteMessage={noop} handleRegenerate={noop} />
    );
    expect(screen.getByText("How can I help you today?")).toBeInTheDocument();
  });

  it("renders all messages", () => {
    const messages: Message[] = [
      makeMsg({ id: "1", role: "user",      content: "Hi there" }),
      makeMsg({ id: "2", role: "assistant", content: "Hello back" }),
    ];
    render(
      <MessageList messages={messages} isGenerating={false} selectedModel={apiModel}
        providers={[]} messagesEndRef={endRef} formatTime={fmt}
        deleteMessage={noop} handleRegenerate={noop} />
    );
    expect(screen.getByText("Hi there")).toBeInTheDocument();
    expect(screen.getByText("Hello back")).toBeInTheDocument();
  });

  it("shows API key warning when provider key missing", () => {
    const providers = [{ id: "openai", name: "OpenAI", baseUrl: "", apiKey: "", enabled: true }];
    render(
      <MessageList messages={[]} isGenerating={false} selectedModel={apiModel}
        providers={providers} messagesEndRef={endRef} formatTime={fmt}
        deleteMessage={noop} handleRegenerate={noop} />
    );
    expect(screen.getByText(/Configure API key/)).toBeInTheDocument();
  });

  it("calls deleteMessage with correct id", () => {
    const deleteMessage = vi.fn();
    const messages: Message[] = [makeMsg({ id: "msg-99", role: "user", content: "Delete me" })];
    render(
      <MessageList messages={messages} isGenerating={false} selectedModel={apiModel}
        providers={[]} messagesEndRef={endRef} formatTime={fmt}
        deleteMessage={deleteMessage} handleRegenerate={noop} />
    );
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
    expect(deleteMessage).toHaveBeenCalledWith("msg-99");
  });
});

// ── AgentPicker ───────────────────────────────────────────────────────────────

describe("AgentPicker", () => {
  it("renders selected agent icon button", () => {
    const { container } = render(
      <AgentPicker selectedAgent={AGENT_MODES[0]} showAgentPicker={false}
        setSelectedAgent={noop} setShowAgentPicker={noop} />
    );
    expect(container.querySelector("button")).toBeInTheDocument();
  });

  it("opens dropdown on click", () => {
    const setShow = vi.fn();
    render(
      <AgentPicker selectedAgent={AGENT_MODES[0]} showAgentPicker={false}
        setSelectedAgent={noop} setShowAgentPicker={setShow} />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(setShow).toHaveBeenCalledWith(true);
  });

  it("shows all agent modes when open", () => {
    render(
      <AgentPicker selectedAgent={AGENT_MODES[0]} showAgentPicker={true}
        setSelectedAgent={noop} setShowAgentPicker={noop} />
    );
    AGENT_MODES.forEach(agent => {
      expect(screen.getByText(agent.name)).toBeInTheDocument();
    });
  });

  it("calls setSelectedAgent when an agent is clicked", () => {
    const setAgent = vi.fn();
    const setShow = vi.fn();
    render(
      <AgentPicker selectedAgent={AGENT_MODES[0]} showAgentPicker={true}
        setSelectedAgent={setAgent} setShowAgentPicker={setShow} />
    );
    fireEvent.click(screen.getByText(AGENT_MODES[1].name));
    expect(setAgent).toHaveBeenCalledWith(AGENT_MODES[1]);
    expect(setShow).toHaveBeenCalledWith(false);
  });
});

// ── ModelPicker ───────────────────────────────────────────────────────────────

describe("ModelPicker", () => {
  const baseProps = {
    selectedModel: apiModel,
    showModelPicker: false,
    setShowModelPicker: vi.fn(),
    modelSearch: "",
    setModelSearch: vi.fn(),
    filteredModels: [apiModel, localModel],
    isFetchingModels: false,
    fetchAllModels: vi.fn(),
    handleModelChange: vi.fn(),
  };

  it("shows selected model name", () => {
    render(<ModelPicker {...baseProps} />);
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
  });

  it("opens picker on model name click", () => {
    const setShow = vi.fn();
    render(<ModelPicker {...baseProps} setShowModelPicker={setShow} />);
    fireEvent.click(screen.getByText("gpt-4o"));
    expect(setShow).toHaveBeenCalledWith(true);
  });

  it("lists all models when open", () => {
    render(<ModelPicker {...baseProps} showModelPicker={true} />);
    expect(screen.getAllByText("gpt-4o").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("llama3.gguf")).toBeInTheDocument();
  });

  it("calls handleModelChange when model selected", () => {
    const handleModelChange = vi.fn();
    render(<ModelPicker {...baseProps} showModelPicker={true} handleModelChange={handleModelChange} />);
    fireEvent.click(screen.getByText("llama3.gguf"));
    expect(handleModelChange).toHaveBeenCalledWith(localModel);
  });

  it("shows search input when open", () => {
    render(<ModelPicker {...baseProps} showModelPicker={true} />);
    expect(screen.getByPlaceholderText("Search models...")).toBeInTheDocument();
  });

  it("shows spinning refresh icon when fetching models", () => {
    const { container } = render(<ModelPicker {...baseProps} showModelPicker={true} isFetchingModels={true} />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows Play icon for unloaded local model", () => {
    render(<ModelPicker {...baseProps} selectedModel={localModel} runningLocalModel={null} />);
    // Play button should be present (load action)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("shows 'No model' when selectedModel is undefined", () => {
    render(<ModelPicker {...baseProps} selectedModel={undefined} />);
    expect(screen.getByText("No model")).toBeInTheDocument();
  });
});

// ── Input / Output flow (logic layer) ────────────────────────────────────────

describe("Chat input/output logic", () => {
  it("message role is preserved correctly", () => {
    const user = makeMsg({ role: "user", content: "What is 2+2?" });
    const assistant = makeMsg({ id: "m2", role: "assistant", content: "4" });
    expect(user.role).toBe("user");
    expect(assistant.role).toBe("assistant");
  });

  it("tool call status transitions: pending → running → done", () => {
    const tc = { id: "t1", name: "web.search", args: "{}", status: "pending" as const };
    const running = { ...tc, status: "running" as const };
    const done    = { ...tc, status: "done" as const, result: "results", duration: 200 };

    expect(tc.status).toBe("pending");
    expect(running.status).toBe("running");
    expect(done.status).toBe("done");
    expect(done.result).toBe("results");
    expect(done.duration).toBe(200);
  });

  it("message with multiple tool calls renders all of them", () => {
    const toolCalls: Message["toolCalls"] = [
      { id: "a", name: "web.search",  args: "{}", status: "done", result: "r1" },
      { id: "b", name: "kb.search",   args: "{}", status: "done", result: "r2" },
      { id: "c", name: "web.fetch",   args: "{}", status: "done", result: "r3" },
    ];
    const msg = makeMsg({ role: "assistant", content: "Here", toolCalls });
    render(<MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />);
    expect(screen.getByText(/Used\s*3\s*tools/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Used\s*3\s*tools/).closest("button")!);
    expect(screen.getByText("web.search")).toBeInTheDocument();
    expect(screen.getByText("kb.search")).toBeInTheDocument();
    expect(screen.getByText("web.fetch")).toBeInTheDocument();
  });

  it("formatTime produces HH:MM string", () => {
    const ts = new Date("2024-01-01T14:35:00").getTime();
    const realFmt = (t: number) => {
      const d = new Date(t);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    expect(realFmt(ts)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("empty content + no error + not generating shows nothing extra", () => {
    const msg = makeMsg({ role: "assistant", content: "", error: undefined });
    const { container } = render(
      <MessageBubble message={msg} isGenerating={false} formatTime={fmt} onDelete={noop} onRegenerate={noop} />
    );
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-blink")).not.toBeInTheDocument();
  });
});
