import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { ToolItem, ApiProvider } from "@/types";
import type { Message, AgentMode, ChatTab, ModelDef } from "@/components/chat/types";
import { useAgentRunner } from "@/hooks/useAgentRunner";
import {
  toolConfigsToDefinitions,
  sendChatCompletionStreaming,
  sendBackendAgenticChat,
  sendBackendProviderChatCompletion,
  sendBackendProviderImageGeneration,
  getLocalProvider,
  discoverMcpTools,
  loadMcpServers,
  loadMcpServersFromDb,
  loadToolConfigs,
  saveToolConfigs,
  type McpServerConfig,
  type ToolConfig,
  type ApiMessage,
  type ExecutionMode,
  canExecute,
} from "@/lib/api";
import { engineAuthHeaders, getEnginePort } from "@/lib/localEngine";
import { getProviderModelPref } from "@/lib/providerModelPrefs";
import { Sparkles, Image, Compass, GraduationCap } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useChatStore } from "@/stores/chatStore";

export type McpDiscoveryResult = {
  serverId: string;
  serverName: string;
  tools: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }[];
};

export const AGENT_MODES: AgentMode[] = [
  { id: "chat", name: "Chat", icon: <Sparkles className="w-4 h-4" />, description: "General conversation" },
  { id: "create-image", name: "Create image", icon: <Image className="w-4 h-4" />, description: "Generate images from text" },
  { id: "deep-research", name: "Deep research", icon: <Compass className="w-4 h-4" />, description: "In-depth analysis & research" },
  { id: "guided-learning", name: "Guided learning", icon: <GraduationCap className="w-4 h-4" />, description: "Interactive learning sessions" },
];

const BASE_MODELS: ModelDef[] = [];

const STORAGE_FORCE_OFFLINE_KEY = "ai-server-force-offline";

type LocalAvailableModel = {
  id: string;
  path?: string;
  supported_parameters?: string[];
};

type StreamStats = {
  timings?: {
    predicted_per_second?: number;
    completion_tokens_per_second?: number;
  };
  usage?: {
    completion_tokens?: number;
    total_time?: number;
  };
};

export interface ChatLogicProps {
  tools: ToolItem[];
  onToggleTool: (id: string) => void;
  onModelSelect: (modelName: string) => void;
  onAddTool: (tool: ToolItem) => void;
  newChatTrigger?: number;
  providers: ApiProvider[];
  sessionsPanelOpen?: boolean;
  onActiveModelNameChange?: (name: string | undefined) => void;
  onOpenModelConfig?: () => void;
  onEjectModel?: () => void;
  onTokenCountChange?: (count: number) => void;
  onLoadModel?: (modelId: string, modelName: string, modelPath?: string) => void;
  runningLocalModel?: string | null;
  localModelLoading?: boolean;
}

export function useChatLogic(props: ChatLogicProps) {
  const { providers, onAddTool, onModelSelect, newChatTrigger, onActiveModelNameChange, onTokenCountChange, onLoadModel, runningLocalModel } = props;

  const {
    tabs,
    activeTab,
    messagesMap,
    isGenerating,
    setTabs,
    setActiveTab,
    addMessage,
    updateMessage,
    setIsGenerating,
    addNewTab: addNewTabStore,
    closeTab: closeTabStore,
  } = useChatStore();

  const [input, setInput] = useState("");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [showToolConfig, setShowToolConfig] = useState(false);
  const [showMcpServers, setShowMcpServers] = useState(false);
  const [showAddTool, setShowAddTool] = useState(false);
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [newToolName, setNewToolName] = useState("");
  const [newToolSource, setNewToolSource] = useState("");
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpUrl, setNewMcpUrl] = useState("");
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [toolConfigs, setToolConfigs] = useState<ToolConfig[]>(() => loadToolConfigs());
  const [mcpToolDefs, setMcpToolDefs] = useState<McpDiscoveryResult[]>([]);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<AgentMode>(AGENT_MODES[0]);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const agentModeEnabled = selectedAgent.id !== "chat";
  const agentRunner = useAgentRunner();

  const [forceOffline, setForceOffline] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_FORCE_OFFLINE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [isNetworkOnline, setIsNetworkOnline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });
  const executionMode: ExecutionMode = forceOffline || !isNetworkOnline ? "offline" : "online";

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesMapRef = useRef(messagesMap);
  // Batch token updates: accumulate in ref, flush to state at ~30fps
  const pendingTokenFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountGenerationRef = useRef(0);
  useEffect(() => {
    const changed = () => {
      accountGenerationRef.current += 1;
      abortRef.current?.abort();
      if (pendingTokenFlushRef.current) clearTimeout(pendingTokenFlushRef.current);
      pendingTokenFlushRef.current = null;
      setInput(""); setAttachedImages([]); setMcpServers([]); setMcpToolDefs([]);
    };
    window.addEventListener("account:changed", changed);
    return () => { changed(); window.removeEventListener("account:changed", changed); };
  }, []);

  useEffect(() => {
    messagesMapRef.current = messagesMap;
  }, [messagesMap]);


  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_FORCE_OFFLINE_KEY, String(forceOffline));
    } catch { /* ignore */ }
  }, [forceOffline]);

  useEffect(() => {
    const onForceOfflineChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ forceOffline?: boolean }>).detail;
      if (typeof detail?.forceOffline === "boolean") {
        setForceOffline(detail.forceOffline);
      }
    };
    window.addEventListener("execution-mode:force-offline-changed", onForceOfflineChanged as EventListener);
    return () => {
      window.removeEventListener("execution-mode:force-offline-changed", onForceOfflineChanged as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsNetworkOnline(true);
    const handleOffline = () => setIsNetworkOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Load MCP servers from local storage on mount
  useEffect(() => {
    let active = true;
    void loadMcpServersFromDb().then(servers => { if (active) setMcpServers(servers); }).catch(() => {});
    return () => { active = false; };
  }, []);

  // Track servers that failed discovery so we don't spam them
  const mcpFailedRef = useRef<Map<string, number>>(new Map()); // serverId → last fail timestamp
  const MCP_RETRY_COOLDOWN_MS = 60_000; // 1 minute before retrying a failed server

  // Discover tools from enabled MCP servers on mount or when mcpServers change
  useEffect(() => {
    let cancelled = false;
    const discover = async () => {
      const now = Date.now();
      const enabledServers = mcpServers.filter(s => {
        if (!s.enabled) return false;
        // Skip remote servers with obviously empty/placeholder auth headers
        const isLocal = s.url.includes("localhost") || s.url.includes("127.0.0.1");
        if (!isLocal) {
          const headerVals = Object.values(s.headers || {});
          const hasPlaceholder = headerVals.some(v =>
            !v || v === "" || /YOUR_.*TOKEN|placeholder|<.*>/i.test(String(v))
          );
          if (hasPlaceholder) return false;
        }
        const lastFail = mcpFailedRef.current.get(s.id);
        return !lastFail || (now - lastFail) > MCP_RETRY_COOLDOWN_MS;
      });
      if (enabledServers.length === 0) return;

      const results: McpDiscoveryResult[] = [];
      for (const server of enabledServers) {
        if (cancelled) return;
        try {
          const tools = await discoverMcpTools(server);
          if (tools.length > 0) {
            results.push({ serverId: server.id, serverName: server.name, tools });
          }
        } catch {
          mcpFailedRef.current.set(server.id, Date.now());
        }
      }
      if (!cancelled) setMcpToolDefs(results);
    };
    discover();
    return () => { cancelled = true; };
  }, [mcpServers]);

  const toggleExecutionMode = () => {
    setForceOffline((prev) => !prev);
  };

  const providerOptions = useMemo(() => [
    { id: "local", name: "Local Engine", type: "local" as const },
    ...providers.filter((p) => p.enabled).map((p) => ({ id: p.id, name: p.name, type: "api" as const })),
  ], [providers]);

  const [selectedProviderId, setSelectedProviderId] = useState<string>("local");
  const selectedProviderOption = useMemo(() =>
    providerOptions.find((p) => p.id === selectedProviderId) || providerOptions[0],
    [providerOptions, selectedProviderId]);

  const [fetchedApiModels, setFetchedApiModels] = useState<ModelDef[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const savedApiChatModels = useMemo<ModelDef[]>(() => {
    const items: ModelDef[] = [];

    providers
      .filter((p) => p.enabled)
      .forEach((p) => {
        const pref = getProviderModelPref(p.id);
        if (!pref) return;

        const selectedChat = (pref.selections || [])
          .filter((s) => s.modelType === "chat")
          .map((s) => s.modelId)
          .filter(Boolean);

        const fallback = selectedChat.length > 0
          ? selectedChat
          : (pref.defaultModel ? [pref.defaultModel] : pref.allowedModels || []);

        Array.from(new Set(fallback)).forEach((modelId) => {
          items.push({
            id: `${p.id}-${modelId}`,
            name: modelId,
            params: "-",
            quant: "-",
            source: "api",
            provider: p.name,
            providerId: p.id,
            providerType: p.providerType,
            modelType: "chat",
            // Conservative default: allow tool toggle path for API models.
            supportsTools: true,
          });
        });
      });

    return items;
  }, [providers]);

  const fetchAllModels = useCallback(async () => {
    setIsFetchingModels(true);
    const results: ModelDef[] = [];
    try {
      const localRes = await fetch(`http://localhost:${getEnginePort()}/v1/models/available`, {
        headers: engineAuthHeaders(),
        signal: AbortSignal.timeout(2000),
      });
      if (localRes.ok) {
        const localData = await localRes.json();
        const localModels = (localData.data || []) as LocalAvailableModel[];
        localModels.forEach((m) => {
          results.push({
            id: `local-${m.id}`,
            name: m.id, // we use filename for UI
            params: "-",
            quant: "-",
            source: "local",
            provider: "Local Engine",
            supportsTools: m.supported_parameters?.includes("tools"),
            // Store path so the Load action is robust
            path: m.path
          });
        });
      }
    } catch { /* ignore */ }

    // API model dropdown should use only user-saved models from Settings.
    // In offline mode, avoid API list usage entirely.
    if (executionMode !== "offline") {
      results.push(...savedApiChatModels);
    }

    const deduped = Array.from(new Map(results.map((m) => [m.id, m])).values());
    setFetchedApiModels(deduped);
    setIsFetchingModels(false);
  }, [executionMode, savedApiChatModels]);

  useEffect(() => {
    fetchAllModels();
  }, [fetchAllModels]);

  const allModels = useMemo(() => (fetchedApiModels.length > 0 ? fetchedApiModels : BASE_MODELS), [fetchedApiModels]);
  const models = useMemo(() => allModels, [allModels]);

  const [selectedModel, setSelectedModel] = useState<ModelDef | undefined>(models[0]);

  useEffect(() => {
    if (runningLocalModel) {
      const runningModel = allModels.find(m => {
        if (m.source !== "local") return false;
        if (m.name === runningLocalModel || m.id === runningLocalModel || m.id === `local-${runningLocalModel}`) return true;
        const runningBase = (runningLocalModel.split(/[\\/]/).pop() || runningLocalModel).replace(/\.(gguf|bin)$/i, "");
        const mBase = (m.name.split(/[\\/]/).pop() || m.name).replace(/\.(gguf|bin)$/i, "");
        return runningBase === mBase || runningBase.includes(mBase) || mBase.includes(runningBase);
      });
      if (runningModel) {
        setSelectedModel(prev => prev?.id !== runningModel.id ? runningModel : prev);
        return;
      }
    }

    const preferredDefaults = providers
      .map((p) => ({ providerId: p.id, defaultModel: getProviderModelPref(p.id)?.defaultModel }))
      .filter((v): v is { providerId: string; defaultModel: string } => !!v.defaultModel);

    const preferredModel = preferredDefaults
      .map((v) => allModels.find((m) => m.providerId === v.providerId && m.name === v.defaultModel))
      .find(Boolean);

    if (preferredModel) {
      setSelectedModel(prev => prev?.id !== preferredModel.id ? preferredModel : prev);
      return;
    }

    setSelectedModel((prev) => {
      if (allModels.length > 0 && !allModels.find((m) => m.id === prev?.id)) {
        return allModels[0];
      }
      return prev;
    });
  }, [allModels, runningLocalModel, providers]);

  useEffect(() => {
    if (!selectedModel) return;
    setSelectedProviderId(selectedModel.source === "local" ? "local" : (selectedModel.providerId || "local"));
  }, [selectedModel]);

  useEffect(() => {
    if (executionMode !== "offline") return;
    if (selectedModel?.source === "local") return;
    const firstLocal = allModels.find((m) => m.source === "local");
    if (firstLocal) {
      setSelectedModel(firstLocal);
      return;
    }
    setSelectedModel(undefined);
  }, [executionMode, selectedModel?.source, allModels]);

  useEffect(() => {
    onActiveModelNameChange?.(selectedModel?.name);
  }, [selectedModel?.name, onActiveModelNameChange]);

  const activeTabData = tabs.find((t) => t.id === activeTab);
  const messages = useMemo(() => messagesMap[activeTab] || [], [messagesMap, activeTab]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addNewTab = useCallback(() => {
    const { chat: chatSettings } = useSettingsStore.getState();
    addNewTabStore(chatSettings.allowOnlyOneNewChat);
  }, [addNewTabStore]);

  useEffect(() => {
    if (newChatTrigger && newChatTrigger > 0) addNewTab();
  }, [newChatTrigger, addNewTab]);

  const setMessages = useCallback((updater: (prev: Message[]) => Message[]) => {
    const currentMessages = messagesMap[activeTab] || [];
    useChatStore.getState().setMessages(activeTab, updater(currentMessages));
  }, [activeTab, messagesMap]);

  const openJsonEditor = useCallback((configType: "mcp" | "tools") => {
    const json = configType === "mcp" ? JSON.stringify(mcpServers, null, 2) : JSON.stringify(toolConfigs, null, 2);
    const existingTab = tabs.find((t) => t.type === "json-editor" && t.editorConfig?.configType === configType);
    if (existingTab) {
      setActiveTab(existingTab.id);
      return;
    }
    const id = `json-${configType}-${Date.now()}`;
    const title = configType === "mcp" ? "mcp-servers.json" : "tools-config.json";
    setTabs([...tabs, { id, title, type: "json-editor", editorConfig: { configType, json } }]);
    setActiveTab(id);
  }, [mcpServers, toolConfigs, tabs, setTabs, setActiveTab]);

  const handleJsonSave = useCallback((configType: "mcp" | "tools", json: string) => {
    try {
      if (configType === "mcp") {
        setMcpServers(JSON.parse(json));
      } else {
        setToolConfigs(JSON.parse(json));
      }
    } catch { /* ignore */ }
  }, []);

  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setAttachedImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            setAttachedImages((prev) => [...prev, reader.result as string]);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const removeAttachedImage = (index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    const accountGeneration = accountGenerationRef.current;
    const updateMessage = (tabId: string, messageId: string, updates: Partial<Message>) => {
      if (accountGenerationRef.current === accountGeneration) useChatStore.getState().updateMessage(tabId, messageId, updates);
    };
    const setIsGenerating = (value: boolean) => {
      if (accountGenerationRef.current === accountGeneration) useChatStore.getState().setIsGenerating(value);
    };
    if ((!input.trim() && attachedImages.length === 0) || isGenerating || !selectedModel) return;

    if (executionMode === "offline" && selectedModel.source !== "local") {
      const capturedTab = activeTab;
      const assistantId = (Date.now() + 1).toString();
      addMessage(capturedTab, {
        id: assistantId,
        role: "assistant",
        content: "",
        error: "Offline mode is enabled. Select a local model or switch to online mode.",
        timestamp: Date.now(),
      });
      return;
    }

    // ── Agent mode path ───────────────────────────────────────────────────────
    if (agentModeEnabled && input.trim()) {
      const goal = input.trim();
      setInput("");
      const capturedTab = activeTab;

      // Add user message to chat
      const userMsg: Message = { id: Date.now().toString(), role: "user", content: goal, timestamp: Date.now() };
      addMessage(capturedTab, userMsg);

      const provider = selectedModel.source === "local" ? getLocalProvider() : providers.find((p) => p.id === selectedModel.providerId);
      if (!provider) return;

      // ── Create Image ────────────────────────────────────────────────────────
      if (selectedAgent.id === "create-image") {
        setIsGenerating(true);
        const assistantId = (Date.now() + 1).toString();
        addMessage(capturedTab, { id: assistantId, role: "assistant" as const, content: "", modelName: selectedModel.name, timestamp: Date.now() });
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          if (selectedModel.source === "local") {
            throw new Error("Image generation requires an API provider model.");
          }

          let imageSrc = "";
          try {
            imageSrc = await sendBackendProviderImageGeneration(provider.id, selectedModel.name, goal, "1024x1024", controller.signal);
          } catch {
            imageSrc = "";
          }

          if (imageSrc) {
            const content = `![Generated image](${imageSrc})\n\n*Prompt: ${goal}*`;
            updateMessage(capturedTab, assistantId, { content });
          } else {
            const fallback = await sendBackendProviderChatCompletion(
              provider.id,
              selectedModel.name,
              [
                { role: "system", content: "You are an image generation assistant. Since image API output is unavailable, describe in vivid detail what the generated image would look like. Start with 'Image description:'" },
                { role: "user", content: goal },
              ],
              undefined,
              controller.signal,
            );
            updateMessage(capturedTab, assistantId, { content: fallback.content });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Image generation failed";
          updateMessage(capturedTab, assistantId, { content: "", error: msg });
        } finally {
          setIsGenerating(false);
          abortRef.current = null;
        }
        return;
      }

      // ── Guided Learning ─────────────────────────────────────────────────────
      if (selectedAgent.id === "guided-learning") {
        setIsGenerating(true);
        const assistantId = (Date.now() + 1).toString();
        addMessage(capturedTab, { id: assistantId, role: "assistant" as const, content: "", modelName: selectedModel.name, timestamp: Date.now() });

        try {
          const controller = new AbortController();
          abortRef.current = controller;
          const modelId = selectedModel.source === "local" ? selectedModel.name : selectedModel.id.replace(`${provider.id}-`, "");
          const snapshotMessages = messagesMapRef.current[capturedTab] || [];
          const history: ApiMessage[] = snapshotMessages
            .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
            .slice(-10)
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

          let guidedResponse = "";
          if (selectedModel.source === "local") {
            guidedResponse = await sendChatCompletionStreaming(provider, [
            { role: "system", content: `You are a Socratic tutor. Your goal is to guide the student to discover answers themselves through thoughtful questions and hints rather than giving direct answers. 

Rules:
- Ask probing questions to check understanding before explaining
- Break complex topics into small digestible steps
- Use analogies and real-world examples
- After each explanation, ask a follow-up question to check comprehension
- Celebrate progress and encourage curiosity
- If the student is stuck, give a small hint rather than the full answer
- Format responses clearly with headers and bullet points when helpful` },
            ...history,
            { role: "user", content: goal },
          ], modelId, undefined, undefined, controller.signal);
          } else {
            const guided = await sendBackendProviderChatCompletion(provider.id, modelId, [
            { role: "system", content: `You are a Socratic tutor. Your goal is to guide the student to discover answers themselves through thoughtful questions and hints rather than giving direct answers. 

Rules:
- Ask probing questions to check understanding before explaining
- Break complex topics into small digestible steps
- Use analogies and real-world examples
- After each explanation, ask a follow-up question to check comprehension
- Celebrate progress and encourage curiosity
- If the student is stuck, give a small hint rather than the full answer
- Format responses clearly with headers and bullet points when helpful` },
            ...history,
            { role: "user", content: goal },
          ], undefined, controller.signal);
            guidedResponse = guided.content;
          }

          updateMessage(capturedTab, assistantId, { content: guidedResponse });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Error";
          updateMessage(capturedTab, assistantId, { content: "", error: msg });
        } finally {
          setIsGenerating(false);
          abortRef.current = null;
        }
        return;
      }
      // ── Deep Research (AgentRunner) ─────────────────────────────────────────
      const mcpTools = mcpToolDefs.flatMap((server) =>
        server.tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.inputSchema || { type: "object", properties: {}, required: [] } },
        })),
      );

      const researchTools = selectedAgent.id === "deep-research"
        ? toolConfigs
            .filter((t) => ["web-search", "url-fetch", "js-sandbox", "python-sandbox", "knowledge-base"].includes(t.id))
            .map((t) => ({ ...t, enabled: true }))
        : toolConfigs.filter((t) => canExecute(t, executionMode));

      const researchToolDefs = toolConfigsToDefinitions(researchTools);

      agentRunner.startAgent(goal, {
        provider,
        modelName: selectedModel.source === "local" ? selectedModel.name : selectedModel.id.replace(`${provider.id}-`, ""),
        tools: [...researchToolDefs, ...mcpTools],
        mcpToolDefs,
        mcpServers,
        executionMode,
      });
      return;

    }
    // Capture activeTab at call time to avoid stale closure when tokens arrive
    const capturedTab = activeTab;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      images: attachedImages.length > 0 ? [...attachedImages] : undefined,
      timestamp: Date.now(),
    };
    // Snapshot BEFORE mutation to avoid race condition (Fix 3 & 4)
    const snapshotMessages = messagesMapRef.current[capturedTab] || [];
    const isFirstMessage = snapshotMessages.length === 0;

    addMessage(capturedTab, userMsg);
    const userInput = input.trim();
    setInput("");
    setAttachedImages([]);
    setIsGenerating(true);
    const startTimeMs = Date.now();

    if (isFirstMessage) {
      const { chat: chatSettings } = useSettingsStore.getState();
      const shouldName = chatSettings.autoNaming === "always" ||
        (chatSettings.autoNaming === "auto" && true); // "auto" = name on first message
      if (chatSettings.autoNaming !== "never" && shouldName) {
        const newTitle = userInput.slice(0, 24) + (userInput.length > 24 ? "..." : "");
        setTabs(tabs.map((t) => t.id === capturedTab ? { ...t, title: newTitle } : t));
      }
    }

    const assistantId = (Date.now() + 1).toString();
    addMessage(capturedTab, { id: assistantId, role: "assistant" as const, content: "", modelName: selectedModel.name, timestamp: Date.now() });

    const controller = new AbortController();
    abortRef.current = controller;
    let finalLlamaSpeed: number | undefined = undefined;

    try {
      const provider = selectedModel.source === "local" ? getLocalProvider() : providers.find((p) => p.id === selectedModel.providerId);
      if (!provider) throw new Error("No API provider configured.");

      const modelId = selectedModel.source === "local" ? selectedModel.name : selectedModel.id.replace(`${provider.id}-`, "");
      // Build clean alternating user/assistant context — last 10 messages (5 turns), no empty content
      const rawApiMessages: ApiMessage[] = [...snapshotMessages, userMsg]
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim() !== "")
        .slice(-10)
        .reduce<ApiMessage[]>((acc, m) => {
          // Collapse consecutive same-role messages into one
          const last = acc[acc.length - 1];
          if (last && last.role === m.role) {
            acc[acc.length - 1] = { role: m.role as "user" | "assistant", content: m.content };
            return acc;
          }
          acc.push({ role: m.role as "user" | "assistant", content: m.content });
          return acc;
        }, []);

      // Frontend no longer executes hybrid memory augmentation.
      // Agentic retrieval/orchestration is delegated to backend routes.
      const augmentedInput = userInput;
      const apiMessages = [...rawApiMessages];
      apiMessages[apiMessages.length - 1].content = augmentedInput;

      const builtInTools = toolConfigsToDefinitions(
        toolConfigs.filter(t => canExecute(t, executionMode))
      );
      const mcpTools: typeof builtInTools = mcpToolDefs
        .filter((server) => {
          // In offline mode, only map local MCP servers
          if (executionMode === "offline") {
            const mcpServer = mcpServers.find(s => s.id === server.serverId);
            const isLocal = mcpServer?.url.includes("localhost") || mcpServer?.url.includes("127.0.0.1");
            if (!isLocal) return false;
          }
          return true;
        })
        .flatMap((server) =>
          server.tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: `[MCP: ${server.serverName}] ${t.description}`,
              parameters: t.inputSchema || { type: "object", properties: {}, required: [] },
            },
          })),
        );
      const enabledTools = [...builtInTools, ...mcpTools];
      const backendSupportedToolNames = new Set(["web-search", "url-fetch", "web.search", "web.fetch"]);
      const backendAgentTools = builtInTools.filter((tool) => backendSupportedToolNames.has(tool.function.name));
      const hasTools = enabledTools.length > 0;
      const useToolCallingApi = backendAgentTools.length > 0 && selectedModel.supportsTools === true && selectedModel.source !== "local";
      const advertisedTools = useToolCallingApi ? backendAgentTools : enabledTools;

      const now = new Date();
      const timeContext = `Current date/time: ${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
      const toolList = advertisedTools.map((t) => `- ${t.function.name}: ${t.function.description}`).join("\n");
      const systemPrompt: ApiMessage = {
        role: "system",
        content: useToolCallingApi
          ? `You are a helpful assistant. ${timeContext}\n\nYou have ${advertisedTools.length} tools — call them directly, never claim you lack access.\n\nTools:\n${toolList}`
          : hasTools
          ? `You are a helpful assistant. ${timeContext}\n\nTools (describe usage, the interface executes them):\n${toolList}`
          : `You are a helpful assistant. ${timeContext}`,
      };

      const loopMessages: ApiMessage[] = [systemPrompt, ...apiMessages];
      let maxIterations = 10;

      while (maxIterations-- > 0) {
        if (useToolCallingApi) {
          const backendResult = await sendBackendAgenticChat(
            provider,
            loopMessages,
            modelId,
            backendAgentTools,
            { maxIterations: 10, executionMode },
            controller.signal,
          );

          updateMessage(capturedTab, assistantId, {
            content: backendResult.content || "",
            toolCalls: (backendResult.toolCalls || []).map((tc) => ({
              id: tc.id,
              name: tc.name,
              args: tc.args,
              result: tc.result,
              error: tc.error,
              duration: tc.duration,
              status: (tc.status === "error" ? "error" : "done") as "done" | "error",
            })),
          });
          break;
        }

        let thinkStartTime: number | null = null;
        // rawBuffer accumulates the full unprocessed stream so think-tag detection
        // works correctly even when tags arrive split across multiple tokens.
        let rawBuffer = "";

        // Flush pending token update to React state (~30fps cap to keep UI smooth)
        const flushTokenUpdate = () => {
          pendingTokenFlushRef.current = null;
          const buf = rawBuffer;
          const thinkStartMatch = buf.match(/<think>/i);
          const thinkEndMatch = buf.match(/<\/think>/i);

          const currentMessages = useChatStore.getState().messagesMap[capturedTab] || [];
          const messageToUpdate = currentMessages.find(m => m.id === assistantId);
          if (!messageToUpdate) return;

          let updates: Partial<Message> = {};

          if (thinkStartMatch && thinkEndMatch) {
            const beforeThink = buf.slice(0, thinkStartMatch.index);
            const thinkContent = buf.slice(thinkStartMatch.index! + thinkStartMatch[0].length, thinkEndMatch.index);
            const afterThink = buf.slice(thinkEndMatch.index! + thinkEndMatch[0].length);
            const elapsed = thinkStartTime != null ? Math.round((Date.now() - thinkStartTime) / 1000) : 0;
            thinkStartTime = null;
            updates = {
              content: (beforeThink + afterThink).trimStart(),
              thinkingContent: thinkContent.trim(),
              thinkingTime: elapsed,
            };
          } else if (thinkStartMatch && !thinkEndMatch) {
            if (thinkStartTime == null) thinkStartTime = Date.now();
            const beforeThink = buf.slice(0, thinkStartMatch.index);
            const thinkContent = buf.slice(thinkStartMatch.index! + thinkStartMatch[0].length);
            updates = { content: beforeThink, thinkingContent: thinkContent };
          } else {
            updates = { content: buf };
          }
          updateMessage(capturedTab, assistantId, updates);
        };

        const onToken = (token: string, stats?: StreamStats) => {
          if (stats) {
            if (stats.timings?.predicted_per_second) {
              finalLlamaSpeed = Number(stats.timings.predicted_per_second.toFixed(2));
            } else if (stats.timings?.completion_tokens_per_second) {
              finalLlamaSpeed = Number(stats.timings.completion_tokens_per_second.toFixed(2));
            } else if (stats.usage?.completion_tokens && stats.usage?.total_time) {
              finalLlamaSpeed = Number((stats.usage.completion_tokens / stats.usage.total_time).toFixed(2));
            }
          }

          rawBuffer += token;

          // Schedule a flush at ~30fps — skip if one is already pending
          if (!pendingTokenFlushRef.current) {
            pendingTokenFlushRef.current = setTimeout(flushTokenUpdate, 33);
          }
        };
        if (selectedModel.source === "local") {
          await sendChatCompletionStreaming(provider, loopMessages, modelId, undefined, onToken, controller.signal);
        } else {
          const completion = await sendBackendProviderChatCompletion(provider.id, modelId, loopMessages, undefined, controller.signal);
          rawBuffer += completion.content;
          if (completion.thinking.trim()) {
            rawBuffer += `<think>${completion.thinking}</think>`;
          }
        }
        // Final flush after stream ends to ensure last tokens are shown
        if (pendingTokenFlushRef.current) {
          clearTimeout(pendingTokenFlushRef.current);
          pendingTokenFlushRef.current = null;
        }
        flushTokenUpdate();
        break;
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        let errorMsg = err instanceof Error ? err.message : "Unknown error";
        if (errorMsg.includes("429")) {
          errorMsg = `⚠️ Rate limited by the provider for model "${selectedModel.name}". This free-tier model is temporarily unavailable. Try again in a minute, or switch to a different model.`;
        }
        updateMessage(capturedTab, assistantId, { content: "", error: errorMsg });
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
      const generationTimeSec = (Date.now() - startTimeMs) / 1000;

      // Count tokens: sum of all message content lengths in current tab (rough estimate)
      const finalMessages = messagesMapRef.current[capturedTab] || [];
      const totalChars = finalMessages.reduce((sum, m) => sum + m.content.length, 0);
      const estimatedTokens = Math.round(totalChars / 4);
      onTokenCountChange?.(estimatedTokens);

      const currentAssistantMsg = finalMessages.find(m => m.id === assistantId);
      if (currentAssistantMsg && (currentAssistantMsg.content || currentAssistantMsg.thinkingContent)) {
         const totalLen = (currentAssistantMsg.content?.length || 0) + (currentAssistantMsg.thinkingContent?.length || 0);
         const msgTokens = Math.round(totalLen / 4);
         const msgSpeed = generationTimeSec > 0 ? (msgTokens / generationTimeSec) : 0;
         updateMessage(capturedTab, assistantId, {
           tokensCount: msgTokens,
           generationTime: Number(generationTimeSec.toFixed(1)),
           speed: Number(msgSpeed.toFixed(2)),
           llamaSpeed: finalLlamaSpeed,
         });
      }
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsGenerating(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const { chat: chatSettings } = useSettingsStore.getState();
    // Ctrl+R to regenerate last message
    if (chatSettings.ctrlRToRegenerate && e.ctrlKey && e.key === "r") {
      e.preventDefault();
      const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
      if (lastAssistant) handleRegenerate(lastAssistant.id);
      return;
    }
    if (chatSettings.shiftEnterToSend) {
      // Shift+Enter sends, plain Enter adds newline
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    } else {
      // Default: Enter sends, Shift+Enter adds newline
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const handleModelChange = (model: ModelDef) => {
    const { chat: chatSettings } = useSettingsStore.getState();
    if (chatSettings.unloadOnModelSelect && props.onEjectModel) {
      props.onEjectModel();
    }
    setSelectedModel(model);
    setShowModelPicker(false);
    setModelSearch("");
    onModelSelect(model.name);
  };

  const filteredModels = useMemo(() => {
    const sourceFiltered = executionMode === "offline"
      ? models.filter((m) => m.source === "local")
      : models;

    return sourceFiltered.filter((m) =>
      m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.provider.toLowerCase().includes(modelSearch.toLowerCase()),
    );
  }, [models, modelSearch, executionMode]);

  const closeTab = useCallback((tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    closeTabStore(tabId);
  }, [closeTabStore]);

  const handleAddTool = () => {
    if (!newToolName.trim()) return;
    const newTool: ToolConfig = {
      id: `custom-${Date.now()}`,
      name: newToolName,
      source: newToolSource || `custom/${newToolName.toLowerCase().replace(/\s+/g, "-")}`,
      enabled: true,
      capabilities: [],
      layer: "api",
    };
    setToolConfigs((prev) => [...prev, newTool]);
    onAddTool({ id: newTool.id, name: newTool.name, source: newTool.source, enabled: true, tagLabel: newTool.name.toLowerCase().replace(/\s+/g, "-"), tagColor: "text-primary" });
    setNewToolName(""); setNewToolSource(""); setShowAddTool(false);
  };

  const handleAddMcp = () => {
    if (!newMcpName.trim()) return;
    setMcpServers((prev) => [...prev, { id: `mcp-${Date.now()}`, name: newMcpName, url: newMcpUrl || "http://localhost:3001", status: "disconnected", enabled: true }]);
    setNewMcpName(""); setNewMcpUrl(""); setShowAddMcp(false);
  };

  const removeMcp = (id: string) => setMcpServers((prev) => prev.filter((s) => s.id !== id));
  const toggleMcpEnabled = (id: string) => setMcpServers((prev) => prev.map((s) => s.id === id ? { ...s, enabled: !s.enabled } : s));
  const removeToolConfig = (id: string) => setToolConfigs((prev) => { const next = prev.filter((t) => t.id !== id); saveToolConfigs(next); return next; });
  const toggleToolConfig = (id: string) => setToolConfigs((prev) => { const next = prev.map((t) => t.id === id ? { ...t, enabled: !t.enabled } : t); saveToolConfigs(next); return next; });

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const deleteMessage = useCallback((msgId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  }, [setMessages]);

  const handleRegenerate = useCallback((msgId: string) => {
    const currentMessages = messagesMapRef.current[activeTab] || [];
    const msgIndex = currentMessages.findIndex((m) => m.id === msgId);
    if (msgIndex < 0) return;
    const prevUserMsg = currentMessages.slice(0, msgIndex).reverse().find((m) => m.role === "user");
    if (!prevUserMsg) return;
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    setInput(prevUserMsg.content);
  }, [activeTab, setMessages]);

  const filteredTabs = useMemo(() => {
    const { chat: chatSettings } = useSettingsStore.getState();
    let result = sessionSearch.trim() ? tabs.filter((t) => t.title.toLowerCase().includes(sessionSearch.toLowerCase())) : [...tabs];
    if (chatSettings.sidebarSort === "alphabetical") {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
    } else if (chatSettings.sidebarSort === "created") {
      result = [...result].sort((a, b) => Number(a.id) - Number(b.id));
    }
    // "recent" = default insertion order (most recent last, which is natural)
    return result;
  }, [tabs, sessionSearch]);

  return {
    tabs, setTabs, activeTab, setActiveTab, messagesMap, setMessages,
    input, setInput, isGenerating, setIsGenerating, showModelPicker, setShowModelPicker,
    showProviderPicker, setShowProviderPicker, modelSearch, setModelSearch,
    showToolConfig, setShowToolConfig, showMcpServers, setShowMcpServers,
    showAddTool, setShowAddTool, showAddMcp, setShowAddMcp,
    newToolName, setNewToolName, newToolSource, setNewToolSource,
    newMcpName, setNewMcpName, newMcpUrl, setNewMcpUrl,
    mcpServers, setMcpServers, toolConfigs, setToolConfigs, mcpToolDefs, setMcpToolDefs,
    attachedImages, setAttachedImages, sessionSearch, setSessionSearch,
    selectedAgent, setSelectedAgent, showAgentPicker, setShowAgentPicker,
    agentModeEnabled, agentRunner,
    executionMode, forceOffline, setForceOffline, isNetworkOnline,
    fetchedApiModels, setFetchedApiModels, isFetchingModels, setIsFetchingModels,
    selectedModel, setSelectedModel, filteredTabs,
    toggleExecutionMode, providerOptions, selectedProviderOption, allModels, models,
    activeTabData, messages, addNewTab, openJsonEditor, handleJsonSave,
    handleImageAttach, handlePaste, removeAttachedImage, handleSend, handleStop,
    handleKeyDown, handleModelChange, filteredModels, closeTab, handleAddTool,
    handleAddMcp, removeMcp, toggleMcpEnabled, removeToolConfig, toggleToolConfig,
    formatTime, deleteMessage, handleRegenerate, fileInputRef, messagesEndRef,
    fetchAllModels, sessionsPanelOpen: props.sessionsPanelOpen, providers: props.providers, onOpenModelConfig: props.onOpenModelConfig, onEjectModel: props.onEjectModel,
    selectedProviderId, setSelectedProviderId, onLoadModel, runningLocalModel: props.runningLocalModel, localModelLoading: props.localModelLoading
  };
}
import { engineFetch as fetch } from "@/api/client";
