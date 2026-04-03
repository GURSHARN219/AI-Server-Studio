import type { ToolItem, ApiProvider } from "@/pages/Index";
import { useChatLogic } from "@/components/chat/useChatLogic";
import { ChatUI } from "@/components/chat/ChatUI";

interface ChatPageProps {
  tools: ToolItem[];
  onToggleTool: (id: string) => void;
  onModelSelect: (modelName: string) => void;
  onAddTool: (tool: ToolItem) => void;
  newChatTrigger?: number;
  providers: ApiProvider[];
  sessionsPanelOpen?: boolean;
  onActiveModelNameChange?: (name: string) => void;
  onOpenModelConfig?: () => void;
  onEjectModel?: () => void;
  onTokenCountChange?: (count: number) => void;
  onLoadModel?: (modelId: string, modelName: string, modelPath?: string) => void;
  runningLocalModel?: string | null;
  localModelLoading?: boolean;
}

export default function ChatPage(props: ChatPageProps) {
  const logic = useChatLogic(props);
  return <ChatUI {...logic} />;
}
