import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Message, ChatTab } from "@/components/chat/types";

// Function to clean up interrupted messages
const cleanInterruptedMessages = (messages: Message[]): Message[] => {
  return messages.map(m =>
    m.role === "assistant" && !m.content && !m.error && !m.thinkingContent && !m.toolCalls
      ? { ...m, error: "Generation was interrupted." }
      : m
  );
};

interface ChatState {
  tabs: ChatTab[];
  messagesMap: Record<string, Message[]>;
  activeTab: string;
  isGenerating: boolean;

  // Actions
  setTabs: (tabs: ChatTab[]) => void;
  setActiveTab: (tabId: string) => void;
  setMessages: (tabId: string, messages: Message[]) => void;
  addMessage: (tabId: string, message: Message) => void;
  updateMessage: (tabId:string, messageId: string, updates: Partial<Message>) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  addNewTab: (allowOnlyOneNewChat: boolean) => void;
  closeTab: (tabId: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist<ChatState>(
    (set, get) => ({
      tabs: [{ id: "1", title: "New Chat", type: "chat" }],
      messagesMap: { "1": [] },
      activeTab: "1",
      isGenerating: false,

      setTabs: (tabs) => set({ tabs }),
      setActiveTab: (activeTab) => set({ activeTab }),
      setMessages: (tabId, messages) =>
        set((state) => ({
          messagesMap: { ...state.messagesMap, [tabId]: messages },
        })),
      addMessage: (tabId, message) =>
        set(state => ({
          messagesMap: {
            ...state.messagesMap,
            [tabId]: [...(state.messagesMap[tabId] || []), message],
          }
        })),
      updateMessage: (tabId, messageId, updates) =>
        set(state => ({
          messagesMap: {
            ...state.messagesMap,
            [tabId]: (state.messagesMap[tabId] || []).map(m =>
              m.id === messageId ? { ...m, ...updates } : m
            ),
          }
        })),
      setIsGenerating: (isGenerating) => set({ isGenerating }),
      addNewTab: (allowOnlyOneNewChat) => {
        const { tabs, messagesMap, setActiveTab } = get();
        if (allowOnlyOneNewChat) {
          const existingEmpty = tabs.find(t => t.type === "chat" && (messagesMap[t.id] || []).length === 0);
          if (existingEmpty) {
            setActiveTab(existingEmpty.id);
            return;
          }
        }
        const id = Date.now().toString();
        const newTab: ChatTab = { id, title: "New Chat", type: "chat" };
        const newTabs = [...tabs, newTab];
        const newMessagesMap = { ...messagesMap, [id]: [] };
        set({ tabs: newTabs, messagesMap: newMessagesMap, activeTab: id });
      },
      closeTab: (tabId: string) => {
        const { tabs, activeTab } = get();
        if (tabs.length === 1) return;
        const newTabs = tabs.filter((t) => t.id !== tabId);
        const newActiveTab = activeTab === tabId ? newTabs[newTabs.length - 1].id : activeTab;
        set(state => {
          const newMessagesMap = { ...state.messagesMap };
          delete newMessagesMap[tabId];
          return { tabs: newTabs, activeTab: newActiveTab, messagesMap: newMessagesMap };
        });
      },
    }),
    {
      name: "ai-server-chat-storage", // unique name
      storage: createJSONStorage(() => localStorage),
      // Post-hydration logic
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error("Failed to rehydrate chat store:", error);
          return;
        }
        const hydrated = state as ChatState | undefined;
        if (hydrated) {
          // Clean up any interrupted generations on load
          const cleanedMessagesMap: Record<string, Message[]> = {};
          for (const [tabId, msgs] of Object.entries(hydrated.messagesMap)) {
            cleanedMessagesMap[tabId] = cleanInterruptedMessages(msgs);
          }
          hydrated.messagesMap = cleanedMessagesMap;
          hydrated.isGenerating = false; // Always reset generation state on load
        }
      },
    }
  )
);
