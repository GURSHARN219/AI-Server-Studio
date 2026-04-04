import { Bot, User } from "lucide-react";
import { MessageContent } from "./message-content";
import { ThinkingBlock } from "./thinking-block";
import { ToolCallCard } from "./tool-call-card";
import { BlockReplyBubble } from "./block-reply-bubble";
import { MediaGallery } from "./media-gallery";
import { useUiStore } from "@aistclaw/stores/use-ui-store";
import { resolveTimezone } from "@aistclaw/lib/format";
import type { ChatMessage } from "@aistclaw/types/chat";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const timezone = useUiStore((s) => s.timezone);
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  if (isTool) return null;
  if (message.isNotification) return null;
  if (message.isBlockReply) return <BlockReplyBubble message={message} />;

  const isAssistant = message.role === "assistant";
  const hasThinking = isAssistant && !!message.thinking;
  const hasToolDetails = isAssistant && message.toolDetails && message.toolDetails.length > 0;
  const hasToolCalls = isAssistant && message.tool_calls && message.tool_calls.length > 0;
  const hasContent = !!message.content?.trim();

  if (isAssistant && !hasContent && !hasToolCalls && !hasToolDetails) return null;

  // Tool-only message (no text content) — render compact without bubble wrapper
  const isToolOnly = isAssistant && !hasContent && !hasThinking && (hasToolDetails || hasToolCalls);

  return (
    <div className={`flex gap-3 mb-4 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-card/50 shadow-sm transition-all hover:bg-card">
        {isUser ? <User className="h-5 w-5 text-primary" /> : <Bot className="h-5 w-5 text-primary" />}
      </div>

      {isToolOnly ? (
        /* Compact tool-only card — no bubble wrapper, full width */
        <div className="flex-1 min-w-0 rounded-2xl border bg-muted/20 backdrop-blur-sm divide-y divide-border/50 overflow-hidden shadow-sm">
          {hasThinking && (
            <div className="px-3 py-2">
              <ThinkingBlock text={message.thinking!} />
            </div>
          )}
          {hasToolDetails && message.toolDetails!.map((entry) => (
            <ToolCallCard key={entry.toolCallId} entry={entry} compact />
          ))}
        </div>
      ) : (
        /* Normal message bubble — assistant uses full width, user capped at 85% */
        <div className={`rounded-2xl px-5 py-3.5 transition-all shadow-sm ${
          isUser
            ? "max-w-[85%] bg-primary/5 text-foreground border border-primary/20 hover:border-primary/30"
            : "flex-1 min-w-0 bg-card border border-border/60 hover:border-border/80"
        }`}>
          {hasThinking && (
            <div className="mb-3">
              <ThinkingBlock text={message.thinking!} />
            </div>
          )}
          {hasToolDetails && (
            <div className="mb-3 rounded-xl border border-border/50 bg-muted/30 divide-y divide-border/30 overflow-hidden">
              {message.toolDetails!.map((entry) => (
                <ToolCallCard key={entry.toolCallId} entry={entry} compact />
              ))}
            </div>
          )}
          <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
            <MessageContent content={message.content} role={message.role} mediaBasenames={message.mediaItems?.map((m) => m.path.split("/").pop() ?? "").filter(Boolean)} />
          </div>
          {message.mediaItems && message.mediaItems.length > 0 && (
            <div className="mt-3">
              <MediaGallery items={message.mediaItems} />
            </div>
          )}
          {message.timestamp && (
            <div className={`mt-2 text-[10px] font-medium uppercase tracking-wider opacity-40 ${isUser ? "text-right" : "text-left"}`}>
              {new Intl.DateTimeFormat([], {
                timeZone: resolveTimezone(timezone),
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(message.timestamp))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
