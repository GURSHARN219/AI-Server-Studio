import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("@/stores/accountState", () => ({
  getAccountSetting: (_key: string, fallback: unknown) => fallback,
  setAccountSetting: vi.fn(),
}));

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
    chat: {
      sttModelKey: "",
    },
  }),
}));

vi.mock("@/components/studio/WorkspacePanel", () => ({
  WorkspacePanel: () => <div data-testid="workspace-panel">WorkspacePanel</div>,
}));

vi.mock("@/components/chat/SessionsSidebar", () => ({
  default: () => <div data-testid="sessions-sidebar" />,
}));

vi.mock("@/components/chat/sub-components/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

vi.mock("@/components/chat/sub-components/AgentPicker", () => ({
  AgentPicker: () => <div data-testid="agent-picker" />,
}));

vi.mock("@/components/chat/sub-components/ModelPicker", () => ({
  ModelPicker: () => <div data-testid="model-picker" />,
}));

vi.mock("@/components/chat/AgentProgressPanel", () => ({
  AgentProgressPanel: () => null,
}));

vi.mock("@/components/JsonEditorTab", () => ({
  default: () => null,
}));

import { ChatUI } from "@/components/chat/ChatUI";
import type { useChatLogic } from "@/components/chat/useChatLogic";

function makeProps(overrides: Partial<ReturnType<typeof useChatLogic>> = {}): ReturnType<typeof useChatLogic> {
  return {
    tabs: [
      { id: "1", title: "Gateway Metrics", type: "chat" },
      { id: "2", title: "Route Streaming", type: "chat" },
    ],
    setTabs: vi.fn(),
    activeTab: "1",
    setActiveTab: vi.fn(),
    messagesMap: { "1": [], "2": [] },
    setMessages: vi.fn(),
    input: "",
    setInput: vi.fn(),
    isGenerating: false,
    setIsGenerating: vi.fn(),
    showModelPicker: false,
    setShowModelPicker: vi.fn(),
    showProviderPicker: false,
    setShowProviderPicker: vi.fn(),
    modelSearch: "",
    setModelSearch: vi.fn(),
    showToolConfig: false,
    setShowToolConfig: vi.fn(),
    showMcpServers: false,
    setShowMcpServers: vi.fn(),
    showAddTool: false,
    setShowAddTool: vi.fn(),
    showAddMcp: false,
    setShowAddMcp: vi.fn(),
    newToolName: "",
    setNewToolName: vi.fn(),
    newToolSource: "",
    setNewToolSource: vi.fn(),
    newMcpName: "",
    setNewMcpName: vi.fn(),
    newMcpUrl: "",
    setNewMcpUrl: vi.fn(),
    mcpServers: [],
    setMcpServers: vi.fn(),
    toolConfigs: [],
    setToolConfigs: vi.fn(),
    mcpToolDefs: [],
    setMcpToolDefs: vi.fn(),
    attachedImages: [],
    setAttachedImages: vi.fn(),
    sessionSearch: "",
    setSessionSearch: vi.fn(),
    selectedAgent: { id: "chat", name: "Chat", icon: null, description: "" },
    setSelectedAgent: vi.fn(),
    showAgentPicker: false,
    setShowAgentPicker: vi.fn(),
    agentModeEnabled: false,
    agentRunner: { events: [], status: "idle", abortAgent: vi.fn(), runAgent: vi.fn(), reset: vi.fn() } as unknown as ReturnType<typeof useChatLogic>["agentRunner"],
    executionMode: "online",
    forceOffline: false,
    setForceOffline: vi.fn(),
    isNetworkOnline: true,
    fetchedApiModels: [],
    setFetchedApiModels: vi.fn(),
    isFetchingModels: false,
    setIsFetchingModels: vi.fn(),
    selectedModel: undefined,
    setSelectedModel: vi.fn(),
    filteredTabs: [
      { id: "1", title: "Gateway Metrics", type: "chat" },
      { id: "2", title: "Route Streaming", type: "chat" },
    ],
    toggleExecutionMode: vi.fn(),
    providerOptions: [],
    selectedProviderOption: undefined,
    allModels: [],
    models: [],
    activeTabData: { id: "1", title: "Gateway Metrics", type: "chat" },
    messages: [],
    addNewTab: vi.fn(),
    openJsonEditor: vi.fn(),
    handleJsonSave: vi.fn(),
    handleImageAttach: vi.fn(),
    handlePaste: vi.fn(),
    removeAttachedImage: vi.fn(),
    handleSend: vi.fn(),
    handleStop: vi.fn(),
    handleKeyDown: vi.fn(),
    handleModelChange: vi.fn(),
    filteredModels: [],
    closeTab: vi.fn(),
    handleAddTool: vi.fn(),
    handleAddMcp: vi.fn(),
    removeMcp: vi.fn(),
    toggleMcpEnabled: vi.fn(),
    removeToolConfig: vi.fn(),
    toggleToolConfig: vi.fn(),
    formatTime: () => "12:00",
    deleteMessage: vi.fn(),
    handleRegenerate: vi.fn(),
    fileInputRef: { current: null },
    messagesEndRef: { current: null },
    fetchAllModels: vi.fn(),
    sessionsPanelOpen: false,
    providers: [],
    onOpenModelConfig: vi.fn(),
    onEjectModel: vi.fn(),
    selectedProviderId: "",
    setSelectedProviderId: vi.fn(),
    onLoadModel: vi.fn(),
    runningLocalModel: null,
    localModelLoading: false,
    tools: [
      { id: "web-search", name: "Web Search", source: "built-in", enabled: true, tagLabel: "web", tagColor: "" },
      { id: "url-fetch", name: "URL Fetch", source: "built-in", enabled: false, tagLabel: "url", tagColor: "" },
    ],
    onToggleTool: vi.fn(),
    renameTab: vi.fn(),
    clearMessages: vi.fn(),
    compactMessages: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleTheme: vi.fn(),
    ...overrides,
  };
}

describe("ChatUI Studio Workspace options", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders slim header with editable title, history, more actions, panel toggle, and new chat", () => {
    const props = makeProps();
    render(<ChatUI {...props} />);

    // Click title to rename
    fireEvent.click(screen.getByTitle("Click to rename"));
    const renameInput = screen.getByLabelText("Rename conversation");
    fireEvent.change(renameInput, { target: { value: "Renamed Session" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    expect(props.renameTab).toHaveBeenCalledWith("1", "Renamed Session");

    // New chat button
    fireEvent.click(screen.getByLabelText("New chat"));
    expect(props.addNewTab).toHaveBeenCalledTimes(1);
  });

  it("opens chat history popover and allows switching or creating chats", () => {
    const props = makeProps();
    render(<ChatUI {...props} />);

    fireEvent.click(screen.getByLabelText("Chat history"));
    expect(screen.getByPlaceholderText("Search chats...")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Route Streaming"));
    expect(props.setActiveTab).toHaveBeenCalledWith("2");
  });

  it("opens more actions menu with compact, clear, toggle theme, and settings", () => {
    const props = makeProps();
    render(<ChatUI {...props} />);

    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(screen.getByText("Compact history"));
    expect(props.compactMessages).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(screen.getByText("Clear messages"));
    expect(props.clearMessages).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(screen.getByText("Toggle theme"));
    expect(props.onToggleTheme).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(screen.getByText("Settings"));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("renders quick chips and tools popover in the composer", () => {
    const props = makeProps();
    render(<ChatUI {...props} />);

    expect(screen.getByText("Refactor Code")).toBeInTheDocument();
    expect(screen.getByText("Open Preview")).toBeInTheDocument();
    expect(screen.getByText("Explain Diff")).toBeInTheDocument();
    expect(screen.getByText("Check Routes")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Tools"));
    expect(screen.getByText("Active Tools")).toBeInTheDocument();
    fireEvent.click(screen.getByText("URL Fetch"));
    expect(props.onToggleTool).toHaveBeenCalledWith("url-fetch");
  });

  it("toggles workspace pane from the header", () => {
    const props = makeProps();
    render(<ChatUI {...props} />);

    fireEvent.click(screen.getByLabelText("Open workspace pane"));
    expect(screen.getByTestId("workspace-panel")).toBeInTheDocument();
  });
});
