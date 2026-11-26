import { create } from "zustand";
import type { Message, ChatTab } from "@/components/chat/types";

// Function to clean up interrupted messages
const cleanInterruptedMessages = (messages: Message[]): Message[] => {
  return messages.map(m =>
    m.role === "assistant" && !m.content && !m.error && !m.thinkingContent && !m.toolCalls
      ? { ...m, error: "Generation was interrupted." }
      : m
  );
};

export interface ChatState {
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
    })
);

export type PersistedChatState = Pick<ChatState, "tabs" | "messagesMap" | "activeTab">;
export const emptyChatState = (): PersistedChatState => ({ tabs: [{ id: "1", title: "New Chat", type: "chat" }], messagesMap: { "1": [] }, activeTab: "1" });
export function hydrateChatState(data: PersistedChatState | null): void {
  const state = data?.tabs?.length && data.messagesMap ? data : emptyChatState();
  useChatStore.setState({ ...state, messagesMap: Object.fromEntries(Object.entries(state.messagesMap).map(([id, messages]) => [id, cleanInterruptedMessages(messages)])), isGenerating: false });
}
