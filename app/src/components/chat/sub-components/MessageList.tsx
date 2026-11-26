import React from "react";
import MessageBubble from "@/components/chat/MessageBubble";
import type { Message, ModelDef } from "@/components/chat/types";
import type { ApiProvider } from "@/types";
import { useSettingsStore } from "@/stores/settingsStore";

interface MessageListProps {
  messages: Message[];
  isGenerating: boolean;
  selectedModel: ModelDef | undefined;
  providers: ApiProvider[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  formatTime: (ts: number) => string;
  deleteMessage: (id: string) => void;
  handleRegenerate: (id: string) => void;
  onOpenFile?: (file: string) => void;
}

export function MessageList({
  messages, isGenerating, selectedModel, providers,
  messagesEndRef, formatTime, deleteMessage, handleRegenerate,
  onOpenFile,
}: MessageListProps) {
  const { appearance } = useSettingsStore();
  const maxWidth = appearance.expandChatToWindowWidth ? "100%" : "48rem";
  const isBubble = appearance.chatMessagesStyle === "bubble";
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-20">
        <div className="w-16 h-16 flex items-center justify-center mb-6 flex-shrink-0">
          <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
        </div>
        <h3 className="text-2xl font-semibold text-foreground mb-3 text-center tracking-tight">How can I help you today?</h3>
        <p className="text-sm text-muted-foreground mb-8 text-center max-w-md leading-relaxed">
          Select a model from the top or adjust your tools, then start typing below to begin chatting.
        </p>
        {selectedModel?.source === "api" && !providers.find((p) => p.id === selectedModel.providerId)?.enabled && (
          <div className="px-4 py-2.5 bg-destructive/10 border border-destructive/20 rounded-lg shadow-sm">
            <p className="text-xs text-destructive font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
               Enable this saved provider in API Gateway → API Providers
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="py-4 px-4 space-y-3 w-full mx-auto" style={{ maxWidth }}>
      {messages.map((msg, idx) => {
        // For showGenInfo "last": only show metrics on the last assistant message
        const isLastAssistant = msg.role === "assistant" &&
          messages.slice(idx + 1).every(m => m.role !== "assistant");
        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            isGenerating={isGenerating && msg.id === messages[messages.length - 1]?.id}
            isLastAssistant={isLastAssistant}
            formatTime={formatTime}
            onDelete={() => deleteMessage(msg.id)}
            onRegenerate={() => handleRegenerate(msg.id)}
            onOpenFile={onOpenFile}
          />
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );
}
