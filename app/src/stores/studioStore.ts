import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  MOCK_BOOKMARKS,
  MOCK_DOWNLOADS,
  MOCK_FILES,
  MOCK_HISTORY,
} from "@/data/mockWorkspace";
import type {
  BookmarkItem,
  BrowserTab,
  ChatMessage,
  ComposerMode,
  Conversation,
  Destination,
  DownloadItem,
  FileNode,
  HistoryEntry,
  KnowledgeItem,
  LayoutMode,
  PopupSize,
  StudioTool,
  ThemeMode,
  WorkspaceView,
} from "@/types/studio";
import type { ApiProvider } from "@/types";
import type { ModelDef } from "@/components/chat/types";
import { getLocalProvider, sendBackendProviderChatCompletion, sendChatCompletionStreaming } from "@/lib/api";

export function flattenFiles(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      result.push(node);
    } else if (node.children) {
      result.push(...flattenFiles(node.children));
    }
  }
  return result;
}

export function findFileByPath(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.type === "file" && node.path === path) return node;
    if (node.children) {
      const found = findFileByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

let activeChatRequest: AbortController | null = null;
let lastWorkspaceModel: ModelDef | undefined;
let lastWorkspaceProviders: ApiProvider[] = [];

interface StudioState {
  // Layout & Theme
  layoutMode: LayoutMode;
  workspaceView: WorkspaceView;
  popupSize: PopupSize;
  sidebarWidth: number;
  theme: ThemeMode;
  activeDestination: Destination;
  commandPaletteOpen: boolean;
  quickOpenOpen: boolean;
  noticeDismissed: boolean;

  // Status bar
  isOnline: boolean;
  engineStatus: "ready" | "busy" | "offline";
  tokenCount: number;
  tokenLimit: number;

  // Chat
  conversations: Conversation[];
  activeConversationId: string;
  composerMode: ComposerMode;
  selectedModelId: string;
  tools: StudioTool[];
  knowledge: KnowledgeItem[];
  isGenerating: boolean;

  // Code Workspace
  files: FileNode[];
  openFilePaths: string[];
  activeFilePath: string;
  splitFilePath: string | null;
  splitViewOpen: boolean;
  diffViewOpen: boolean;
  minimapOpen: boolean;
  explorerOpen: boolean;
  terminalOpen: boolean;

  // Browser Workspace
  browserTabs: BrowserTab[];
  activeBrowserTabId: string;
  bookmarks: BookmarkItem[];
  history: HistoryEntry[];
  downloads: DownloadItem[];

  // Settings

  // Actions
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setWorkspaceView: (view: WorkspaceView) => void;
  setPopupSize: (size: PopupSize) => void;
  setSidebarWidth: (width: number) => void;
  setActiveDestination: (dest: Destination) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setQuickOpenOpen: (open: boolean) => void;
  dismissNotice: () => void;
  toggleOnline: () => void;

  // Chat actions
  setActiveConversation: (id: string) => void;
  createConversation: () => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  clearConversationMessages: (id: string) => void;
  compactConversation: (id: string) => void;
  setComposerMode: (mode: ComposerMode) => void;
  setSelectedModelId: (id: string) => void;
  toggleTool: (id: string) => void;
  toggleKnowledge: (id: string) => void;
  sendMessage: (content: string, model?: ModelDef, providers?: ApiProvider[]) => void;
  editUserMessage: (messageId: string, content: string) => void;
  regenerateMessage: (messageId: string) => void;
  setMessageFeedback: (messageId: string, feedback: "like" | "dislike" | null) => void;
  stopGeneration: () => void;

  // Code actions
  openFile: (path: string) => void;
  closeFileTab: (path: string) => void;
  reorderFileTabs: (fromIndex: number, toIndex: number) => void;
  setSplitFilePath: (path: string | null) => void;
  toggleSplitView: () => void;
  toggleDiffView: () => void;
  toggleMinimap: () => void;
  toggleExplorer: () => void;
  toggleTerminal: () => void;
  updateFileContent: (path: string, content: string) => void;

  // Browser actions
  openUrlInBrowser: (url: string, newTab?: boolean) => void;
  createBrowserTab: (url?: string) => void;
  closeBrowserTab: (id: string) => void;
  setActiveBrowserTab: (id: string) => void;
  updateBrowserTab: (id: string, patch: Partial<BrowserTab>) => void;
  addBookmark: (title: string, url: string) => void;
  removeBookmark: (id: string) => void;
  addHistoryEntry: (title: string, url: string) => void;
  clearHistory: () => void;
  clearDownloads: () => void;

  // Settings actions
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set, get) => ({
      layoutMode: "chat",
      workspaceView: "code",
      popupSize: "collapsed",
      sidebarWidth: 380,
      theme: "light",
      activeDestination: "chat",
      commandPaletteOpen: false,
      quickOpenOpen: false,
      noticeDismissed: false,

      isOnline: true,
      engineStatus: "ready",
      tokenCount: 12480,
      tokenLimit: 128000,

      conversations: [{ id: "conv-workspace", title: "New Chat Session", updatedAt: "Just now", model: "", messages: [] }],
      activeConversationId: "conv-workspace",
      composerMode: "agent",
      selectedModelId: "",
      tools: [],
      knowledge: [],
      isGenerating: false,

      files: MOCK_FILES,
      openFilePaths: [
        "src/components/MetricsPanel.tsx",
        "src/server/router.ts",
        "src/App.tsx",
      ],
      activeFilePath: "src/components/MetricsPanel.tsx",
      splitFilePath: "src/server/router.ts",
      splitViewOpen: false,
      diffViewOpen: false,
      minimapOpen: true,
      explorerOpen: true,
      terminalOpen: false,

      browserTabs: [
        {
          id: "btab-1",
          title: "AI Gateway Health — localhost:5173",
          url: "http://localhost:5173",
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          zoom: 100,
          isSecure: true,
        },
      ],
      activeBrowserTabId: "btab-1",
      bookmarks: MOCK_BOOKMARKS,
      history: MOCK_HISTORY,
      downloads: MOCK_DOWNLOADS,


      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      setLayoutMode: (layoutMode) => set({ layoutMode }),
      setWorkspaceView: (workspaceView) => set({ workspaceView }),
      setPopupSize: (popupSize) => set({ popupSize }),
      setSidebarWidth: (width) => set({ sidebarWidth: Math.min(640, Math.max(300, width)) }),
      setActiveDestination: (activeDestination) => set({ activeDestination }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      setQuickOpenOpen: (quickOpenOpen) => set({ quickOpenOpen }),
      dismissNotice: () => set({ noticeDismissed: true }),
      toggleOnline: () =>
        set((s) => ({
          isOnline: !s.isOnline,
          engineStatus: !s.isOnline ? "ready" : "offline",
        })),

      setActiveConversation: (id) => set({ activeConversationId: id }),
      createConversation: () => {
        const id = `conv-${Date.now()}`;
        const newConv: Conversation = {
          id,
          title: "New Chat Session",
          updatedAt: "Just now",
          model: get().selectedModelId,
          messages: [],
        };
        set((s) => ({
          conversations: [newConv, ...s.conversations],
          activeConversationId: id,
          noticeDismissed: false,
        }));
      },
      renameConversation: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title: title.trim() || c.title } : c,
          ),
        })),
      deleteConversation: (id) =>
        set((s) => {
          const remaining = s.conversations.filter((c) => c.id !== id);
          if (remaining.length === 0) {
            const fallback: Conversation = {
              id: `conv-${Date.now()}`,
              title: "New Chat Session",
              updatedAt: "Just now",
              model: s.selectedModelId,
              messages: [],
            };
            return { conversations: [fallback], activeConversationId: fallback.id };
          }
          const nextActive =
            s.activeConversationId === id ? remaining[0].id : s.activeConversationId;
          return { conversations: remaining, activeConversationId: nextActive };
        }),
      clearConversationMessages: (id) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, messages: [] } : c,
          ),
        })),
      compactConversation: (id) =>
        set((s) => ({
          tokenCount: Math.max(1200, Math.floor(s.tokenCount * 0.35)),
          noticeDismissed: true,
          conversations: s.conversations.map((c) =>
            c.id === id
              ? {
                  ...c,
                  messages: c.messages.slice(-2),
                }
              : c,
          ),
        })),
      setComposerMode: (composerMode) => set({ composerMode }),
      setSelectedModelId: (selectedModelId) => set({ selectedModelId }),
      toggleTool: (id) =>
        set((s) => ({
          tools: s.tools.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
        })),
      toggleKnowledge: (id) =>
        set((s) => ({
          knowledge: s.knowledge.map((k) =>
            k.id === id ? { ...k, enabled: !k.enabled } : k,
          ),
        })),

      stopGeneration: () => {
        activeChatRequest?.abort();
        activeChatRequest = null;
        const activeId = get().activeConversationId;
        set((s) => ({
          isGenerating: false,
          engineStatus: s.isOnline ? "ready" : "offline",
          conversations: s.conversations.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.isStreaming ? { ...m, isStreaming: false } : m,
                  ),
                }
              : c,
          ),
        }));
      },

      sendMessage: async (rawContent, model, providers = []) => {
        const content = rawContent.trim();
        const selectedModel = model ?? lastWorkspaceModel;
        const selectedProviders = providers.length ? providers : lastWorkspaceProviders;
        if (!content || !selectedModel) return;
        lastWorkspaceModel = selectedModel;
        lastWorkspaceProviders = selectedProviders;
        get().stopGeneration();

        const state = get();
        const convId = state.activeConversationId;
        const now = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const userMsg: ChatMessage = { id: `msg-${Date.now()}-u`, role: "user", content, timestamp: now };
        const assistantId = `msg-${Date.now()}-a`;
        const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", content: "", timestamp: now, isStreaming: true };
        const priorMessages = state.conversations.find((conversation) => conversation.id === convId)?.messages ?? [];
        const modeInstructions = state.composerMode === "plan"
          ? "Help plan the requested work. Give an ordered, practical plan and ask only for information that is truly needed."
          : state.composerMode === "ask"
            ? "Answer the user's questions directly and explain relevant code concepts. Do not claim to have changed files or run commands."
            : "Act as a coding assistant for AI Server Studio. Give concrete code guidance. You have no workspace tools in this conversation, so do not claim to have inspected, edited, or run anything.";
        const history = [
          { role: "system" as const, content: modeInstructions },
          ...priorMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          { role: userMsg.role, content: userMsg.content },
        ];

        set((s) => ({
          isGenerating: true,
          engineStatus: s.isOnline ? "busy" : "offline",
          popupSize: s.layoutMode === "full" ? "expanded" : s.popupSize,
          conversations: s.conversations.map((conversation) => {
            if (conversation.id !== convId) return conversation;
            return {
              ...conversation,
              title: conversation.messages.length === 0 && conversation.title.startsWith("New ") ? content.slice(0, 36) : conversation.title,
              updatedAt: "Just now",
              model: selectedModel.id,
              messages: [...conversation.messages, userMsg, assistantMsg],
            };
          }),
        }));

        const controller = new AbortController();
        activeChatRequest = controller;
        const updateAssistant = (patch: Partial<ChatMessage>) => set((s) => ({
          conversations: s.conversations.map((conversation) => conversation.id !== convId ? conversation : {
            ...conversation,
            messages: conversation.messages.map((message) => message.id === assistantId ? { ...message, ...patch } : message),
          }),
        }));
        try {
          if (selectedModel.source === "local") {
            const provider = getLocalProvider();
            await sendChatCompletionStreaming(provider, history, selectedModel.name, undefined, (token) => {
              if (!token) return;
              const current = get().conversations.find((conversation) => conversation.id === convId)?.messages.find((message) => message.id === assistantId)?.content ?? "";
              updateAssistant({ content: current + token });
            }, controller.signal);
          } else {
            const provider = selectedProviders.find((item) => item.id === selectedModel.providerId);
            if (!provider) throw new Error("The selected provider is unavailable. Refresh models and choose a saved model.");
            const modelName = selectedModel.id.startsWith(`${provider.id}-`) ? selectedModel.id.slice(provider.id.length + 1) : selectedModel.name;
            const result = await sendBackendProviderChatCompletion(provider.id, modelName, history, undefined, controller.signal);
            updateAssistant({ content: result.content });
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            updateAssistant({ content: `Unable to get a response: ${error instanceof Error ? error.message : "Model request failed."}` });
          }
        } finally {
          updateAssistant({ isStreaming: false });
          if (activeChatRequest === controller) {
            activeChatRequest = null;
            set((s) => ({ isGenerating: false, engineStatus: s.isOnline ? "ready" : "offline" }));
          }
        }
      },

      editUserMessage: (messageId, content) => {
        const trimmed = content.trim();
        if (!trimmed) return;
        const convId = get().activeConversationId;
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, content: trimmed } : m,
                  ),
                }
              : c,
          ),
        }));
      },

      regenerateMessage: (messageId) => {
        const conv = get().conversations.find((c) => c.id === get().activeConversationId);
        if (!conv) return;
        const idx = conv.messages.findIndex((m) => m.id === messageId);
        if (idx <= 0) return;
        const prevUser = [...conv.messages.slice(0, idx)]
          .reverse()
          .find((m) => m.role === "user");
        if (prevUser && lastWorkspaceModel) {
          const userIndex = conv.messages.findIndex((message) => message.id === prevUser.id);
          set((s) => ({
            conversations: s.conversations.map((conversation) => conversation.id === conv.id
              ? { ...conversation, messages: conversation.messages.slice(0, userIndex) }
              : conversation),
          }));
          get().sendMessage(prevUser.content, lastWorkspaceModel, lastWorkspaceProviders);
        }
      },

      setMessageFeedback: (messageId, feedback) => {
        const convId = get().activeConversationId;
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, feedback } : m,
                  ),
                }
              : c,
          ),
        }));
      },

      openFile: (path) =>
        set((s) => ({
          layoutMode: s.layoutMode === "chat" ? "split" : s.layoutMode,
          workspaceView: "code",
          activeDestination: "files",
          activeFilePath: path,
          openFilePaths: s.openFilePaths.includes(path)
            ? s.openFilePaths
            : [...s.openFilePaths, path],
        })),

      closeFileTab: (path) =>
        set((s) => {
          const next = s.openFilePaths.filter((p) => p !== path);
          const nextActive =
            s.activeFilePath === path ? (next[next.length - 1] ?? "") : s.activeFilePath;
          return { openFilePaths: next, activeFilePath: nextActive };
        }),

      reorderFileTabs: (fromIndex, toIndex) =>
        set((s) => {
          const next = [...s.openFilePaths];
          const [moved] = next.splice(fromIndex, 1);
          if (!moved) return s;
          next.splice(toIndex, 0, moved);
          return { openFilePaths: next };
        }),

      setSplitFilePath: (splitFilePath) => set({ splitFilePath }),
      toggleSplitView: () => set((s) => ({ splitViewOpen: !s.splitViewOpen })),
      toggleDiffView: () => set((s) => ({ diffViewOpen: !s.diffViewOpen })),
      toggleMinimap: () => set((s) => ({ minimapOpen: !s.minimapOpen })),
      toggleExplorer: () => set((s) => ({ explorerOpen: !s.explorerOpen })),
      toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),

      updateFileContent: (path, content) => {
        const updateTree = (nodes: FileNode[]): FileNode[] =>
          nodes.map((node) => {
            if (node.type === "file" && node.path === path) {
              return { ...node, content, changed: true };
            }
            if (node.children) {
              return { ...node, children: updateTree(node.children) };
            }
            return node;
          });
        set((s) => ({ files: updateTree(s.files) }));
      },

      openUrlInBrowser: (url, newTab = false) => {
        const normalized = url.startsWith("http") || url.startsWith("about:")
          ? url
          : `https://${url}`;
        set((s) => {
          const nextMode = s.layoutMode === "chat" ? "split" : s.layoutMode;
          if (newTab || s.browserTabs.length === 0) {
            const id = `btab-${Date.now()}`;
            const tab: BrowserTab = {
              id,
              title: normalized.replace(/^https?:\/\//, ""),
              url: normalized,
              isLoading: true,
              canGoBack: false,
              canGoForward: false,
              zoom: useSettingsStore.getState().browser.defaultZoom,
              isSecure: normalized.startsWith("https://") || normalized.includes("localhost"),
            };
            return {
              layoutMode: nextMode,
              workspaceView: "browser",
              activeDestination: "browser",
              browserTabs: [...s.browserTabs, tab],
              activeBrowserTabId: id,
            };
          }
          return {
            layoutMode: nextMode,
            workspaceView: "browser",
            activeDestination: "browser",
            browserTabs: s.browserTabs.map((t) =>
              t.id === s.activeBrowserTabId
                ? {
                    ...t,
                    url: normalized,
                    title: normalized.replace(/^https?:\/\//, ""),
                    isLoading: true,
                    canGoBack: true,
                    isSecure: normalized.startsWith("https://") || normalized.includes("localhost"),
                  }
                : t,
            ),
          };
        });
      },

      createBrowserTab: (url) => {
        const target = url ?? useSettingsStore.getState().browser.homepage;
        get().openUrlInBrowser(target, true);
      },

      closeBrowserTab: (id) =>
        set((s) => {
          const next = s.browserTabs.filter((t) => t.id !== id);
          if (next.length === 0) {
            const fallback: BrowserTab = {
              id: `btab-${Date.now()}`,
              title: "New Tab",
              url: useSettingsStore.getState().browser.homepage,
              isLoading: false,
              canGoBack: false,
              canGoForward: false,
              zoom: useSettingsStore.getState().browser.defaultZoom,
              isSecure: true,
            };
            return { browserTabs: [fallback], activeBrowserTabId: fallback.id };
          }
          const nextActive =
            s.activeBrowserTabId === id ? next[next.length - 1].id : s.activeBrowserTabId;
          return { browserTabs: next, activeBrowserTabId: nextActive };
        }),

      setActiveBrowserTab: (activeBrowserTabId) => set({ activeBrowserTabId }),

      updateBrowserTab: (id, patch) =>
        set((s) => ({
          browserTabs: s.browserTabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),

      addBookmark: (title, url) =>
        set((s) => {
          if (s.bookmarks.some((b) => b.url === url)) return s;
          return {
            bookmarks: [
              ...s.bookmarks,
              { id: `bm-${Date.now()}`, title: title || url, url, folder: "Bookmarks" },
            ],
          };
        }),

      removeBookmark: (id) =>
        set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) })),

      addHistoryEntry: (title, url) =>
        set((s) => ({
          history: [
            {
              id: `h-${Date.now()}`,
              title: title || url,
              url,
              visitedAt: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
              dayGroup: "Today",
            },
            ...s.history.slice(0, 49),
          ],
        })),

      clearHistory: () => set({ history: [] }),
      clearDownloads: () => set({ downloads: [] }),

    }),
    {
      name: "ai-server-studio-ui-v2",
      partialize: (state) => ({
        layoutMode: state.layoutMode,
        workspaceView: state.workspaceView,
        popupSize: state.popupSize,
        sidebarWidth: state.sidebarWidth,
        noticeDismissed: state.noticeDismissed,
        theme: state.theme,
        openFilePaths: state.openFilePaths,
        activeFilePath: state.activeFilePath,
        minimapOpen: state.minimapOpen,
        explorerOpen: state.explorerOpen,
        bookmarks: state.bookmarks,
      }),
    },
  ),
);
