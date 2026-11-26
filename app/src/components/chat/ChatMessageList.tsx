import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  GitBranch,
  Globe,
  Layers,
  Pencil,
  RefreshCw,
  RotateCcw,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  X,
  Zap,
} from "lucide-react";
import { useStudioStore } from "@/stores/studioStore";
import type { ChatMessage, ToolCallItem } from "@/types/studio";

interface ChatMessageListProps {
  messages: ChatMessage[];
  onQuickPrompt?: (text: string) => void;
}

const ToolCallPill: React.FC<{ item: ToolCallItem }> = ({ item }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="w-full rounded-lg border border-edge-subtle bg-surface-subtle/70 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-surface-hover/70"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-ink-muted" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-ink-muted" />
          )}
          <Terminal className="h-3 w-3 shrink-0 text-ink-muted" />
          <span className="shrink-0 font-mono text-[11px] font-semibold text-ink-primary">
            {item.tool}
          </span>
          <span className="min-w-0 truncate text-[11px] text-ink-secondary">
            {item.summary}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-muted">
          {item.durationMs}ms
        </span>
      </button>
      {expanded && (
        <div className="space-y-1.5 border-t border-edge-subtle px-3 py-2 font-mono text-[11px] text-ink-secondary">
          {item.input && (
            <div>
              <span className="text-[10px] font-semibold uppercase text-ink-muted">Input: </span>
              <span className="break-all text-ink-primary">{item.input}</span>
            </div>
          )}
          <div>
            <span className="text-[10px] font-semibold uppercase text-ink-muted">Output: </span>
            <span className="break-all">{item.output ?? item.detail ?? "Completed"}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);
  const openFile = useStudioStore((s) => s.openFile);
  const activeFilePath = useStudioStore((s) => s.activeFilePath);

  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-edge-subtle bg-surface-code">
      <div className="flex items-center justify-between border-b border-edge-subtle bg-surface-subtle/60 px-3 py-1.5 text-[11px] text-ink-muted">
        <span className="font-mono font-medium">{language || "code"}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openFile(activeFilePath || "src/server/router.ts")}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
          >
            <Code2 className="h-3 w-3" />
            Open Code
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
          >
            {copied ? <Check className="h-3 w-3 text-state-success" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-ink-primary">
        <code>{code}</code>
      </pre>
    </div>
  );
};

function renderInlineMarkdown(
  text: string,
  onOpenUrl: (url: string) => void,
): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g);
  return tokens.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={idx} className="font-semibold text-ink-primary">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={idx}
          className="rounded border border-edge-subtle bg-surface-subtle px-1 py-0.5 font-mono text-[11.5px] text-ink-primary"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const mdLink = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (mdLink) {
      return (
        <button
          key={idx}
          type="button"
          onClick={() => onOpenUrl(mdLink[2])}
          className="inline-flex items-center gap-0.5 text-accent-fg underline-offset-2 hover:underline"
        >
          <span>{mdLink[1]}</span>
          <ExternalLink className="h-3 w-3" />
        </button>
      );
    }
    if (part.startsWith("http://") || part.startsWith("https://")) {
      return (
        <button
          key={idx}
          type="button"
          onClick={() => onOpenUrl(part)}
          className="inline-flex items-center gap-0.5 text-accent-fg underline-offset-2 hover:underline"
        >
          <span>{part}</span>
          <ExternalLink className="h-3 w-3" />
        </button>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

const MarkdownContent: React.FC<{ content: string; isStreaming?: boolean }> = ({
  content,
  isStreaming,
}) => {
  const openUrlInBrowser = useStudioStore((s) => s.openUrlInBrowser);
  const blocks = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2 break-words text-[13px] leading-relaxed text-ink-primary">
      {blocks.map((block, bIdx) => {
        if (block.startsWith("```") && block.endsWith("```")) {
          const inner = block.slice(3, -3);
          const firstNewline = inner.indexOf("\n");
          const lang = firstNewline >= 0 ? inner.slice(0, firstNewline).trim() : "";
          const code = firstNewline >= 0 ? inner.slice(firstNewline + 1) : inner;
          return <CodeBlock key={bIdx} language={lang} code={code} />;
        }

        const lines = block.split("\n");
        return (
          <div key={bIdx} className="space-y-1.5">
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (!trimmed) return null;
              if (trimmed.startsWith("- ")) {
                return (
                  <div key={lIdx} className="flex items-start gap-2 pl-1">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                    <div className="min-w-0 flex-1">
                      {renderInlineMarkdown(trimmed.slice(2), (u) => openUrlInBrowser(u))}
                    </div>
                  </div>
                );
              }
              return (
                <p key={lIdx}>
                  {renderInlineMarkdown(trimmed, (u) => openUrlInBrowser(u))}
                </p>
              );
            })}
          </div>
        );
      })}
      {isStreaming && (
        <span className="inline-flex items-center gap-1 align-middle text-[11px] text-ink-muted">
          <span className="inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-accent-primary" />
        </span>
      )}
    </div>
  );
};

export const ChatMessageList: React.FC<ChatMessageListProps> = ({
  messages,
  onQuickPrompt,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const openFile = useStudioStore((s) => s.openFile);
  const openUrlInBrowser = useStudioStore((s) => s.openUrlInBrowser);
  const tokenCount = useStudioStore((s) => s.tokenCount);
  const tokenLimit = useStudioStore((s) => s.tokenLimit);
  const noticeDismissed = useStudioStore((s) => s.noticeDismissed);
  const dismissNotice = useStudioStore((s) => s.dismissNotice);
  const compactConversation = useStudioStore((s) => s.compactConversation);
  const activeConversationId = useStudioStore((s) => s.activeConversationId);
  const editUserMessage = useStudioStore((s) => s.editUserMessage);
  const regenerateMessage = useStudioStore((s) => s.regenerateMessage);
  const setMessageFeedback = useStudioStore((s) => s.setMessageFeedback);

  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const capacityPct = Math.round((tokenCount / tokenLimit) * 100);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1]?.content]);

  /* -- Welcome / empty state quick-action cards -- */
  const WELCOME_ACTIONS: {
    icon: React.ReactNode;
    label: string;
    sub: string;
    prompt: string;
    action?: "preview";
  }[] = [
    {
      icon: <RefreshCw className="h-4 w-4" />,
      label: "Refactor Code",
      sub: "Memoize & optimise active file",
      prompt: "Refactor MetricsPanel.tsx to memoize card formatting.",
    },
    {
      icon: <Globe className="h-4 w-4" />,
      label: "Open Preview",
      sub: "Launch localhost in browser pane",
      prompt: "Open localhost:5173 preview.",
      action: "preview",
    },
    {
      icon: <Layers className="h-4 w-4" />,
      label: "Explain Diff",
      sub: "Summarise recent file changes",
      prompt: "Explain the recent changes in MetricsPanel.tsx and router.ts.",
    },
    {
      icon: <Zap className="h-4 w-4" />,
      label: "Check Routes",
      sub: "Validate timeouts in router.ts",
      prompt: "Verify all routes in router.ts have valid timeouts.",
    },
    {
      icon: <GitBranch className="h-4 w-4" />,
      label: "Git Status",
      sub: "Show uncommitted changes",
      prompt: "Show git status and list uncommitted changes.",
    },
    {
      icon: <Terminal className="h-4 w-4" />,
      label: "Run Tests",
      sub: "Execute test suite & report",
      prompt: "Run the test suite and summarise failures.",
    },
  ];

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 text-center">
        <img
          src="/logo.png"
          alt="AI Server Studio"
          className="mb-4 h-12 w-12 rounded-xl object-contain drop-shadow-md"
        />
        <h2 className="text-lg font-semibold tracking-tight text-ink-primary">
          How can I help you today?
        </h2>
        <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-ink-muted">
          Select a model from the top or adjust your tools, then start typing below to begin chatting.
        </p>

        {onQuickPrompt && (
          <div className="mt-6 grid w-full max-w-sm grid-cols-2 gap-2">
            {WELCOME_ACTIONS.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  onQuickPrompt(action.prompt);
                  if (action.action === "preview") {
                    openUrlInBrowser("http://localhost:5173");
                  }
                }}
                className="group flex flex-col items-start gap-1.5 rounded-xl border border-edge-subtle bg-surface-subtle p-3 text-left transition-all duration-150 hover:border-edge-default hover:bg-surface-hover hover:shadow-sm active:scale-[0.98]"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-card text-ink-muted transition-colors group-hover:bg-accent-primary/10 group-hover:text-accent-fg">
                  {action.icon}
                </span>
                <span className="text-[12px] font-semibold text-ink-primary leading-tight">
                  {action.label}
                </span>
                <span className="text-[10.5px] text-ink-muted leading-tight">
                  {action.sub}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-3.5 py-3">
      {messages.map((msg) => {
        if (msg.role === "user") {
          const isEditing = editingMsgId === msg.id;
          return (
            <div key={msg.id} className="group flex items-start justify-end gap-1.5">
              {!isEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingMsgId(msg.id);
                    setEditDraft(msg.content);
                  }}
                  title="Edit message"
                  className="mt-1.5 hidden rounded p-1 text-ink-muted hover:bg-surface-hover hover:text-ink-primary group-hover:inline-flex"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
              {isEditing ? (
                <div className="w-full max-w-[85%] space-y-1.5 rounded-xl border border-accent-primary bg-surface-bubble-user p-2.5">
                  <textarea
                    autoFocus
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={2}
                    className="w-full resize-none bg-transparent text-[13px] text-ink-primary focus:outline-none"
                  />
                  <div className="flex justify-end gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setEditingMsgId(null)}
                      className="rounded px-2 py-0.5 text-ink-muted hover:bg-surface-hover"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        editUserMessage(msg.id, editDraft);
                        setEditingMsgId(null);
                      }}
                      className="rounded bg-accent-primary px-2.5 py-0.5 font-medium text-ink-inverse"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="max-w-[85%] rounded-xl border border-edge-subtle bg-surface-bubble-user px-3.5 py-2 text-[13px] text-ink-primary">
                  {msg.content}
                </div>
              )}
            </div>
          );
        }

        return (
          <div key={msg.id} className="group space-y-2.5">
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="space-y-1.5">
                {msg.toolCalls.map((tc) => (
                  <ToolCallPill key={tc.id} item={tc} />
                ))}
              </div>
            )}

            <MarkdownContent content={msg.content} isStreaming={msg.isStreaming} />

            {(msg.editedFiles?.length || msg.hasPreviewAction) && !msg.isStreaming && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {msg.editedFiles?.map((ef) => (
                  <button
                    key={ef.path}
                    type="button"
                    onClick={() => openFile(ef.path)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-edge-subtle bg-surface-subtle px-2 py-1 text-[11px] font-medium text-ink-primary hover:border-edge-default hover:bg-surface-hover"
                  >
                    <FileCode2 className="h-3 w-3 text-accent-fg" />
                    <span>Edited {ef.filename}</span>
                    <span className="font-mono text-[10px] text-state-success">+{ef.added}</span>
                    <span className="font-mono text-[10px] text-state-danger">-{ef.removed}</span>
                  </button>
                ))}
                {msg.hasPreviewAction && (
                  <button
                    type="button"
                    onClick={() => openUrlInBrowser("http://localhost:5173")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-edge-subtle bg-surface-subtle px-2 py-1 text-[11px] font-medium text-ink-primary hover:border-edge-default hover:bg-surface-hover"
                  >
                    <Globe className="h-3 w-3 text-accent-fg" />
                    <span>Open preview</span>
                  </button>
                )}
              </div>
            )}

            {/* Hover actions on assistant messages */}
            {!msg.isStreaming && (
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(msg.content);
                    setCopiedId(msg.id);
                    setTimeout(() => setCopiedId(null), 1500);
                  }}
                  title="Copy response"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                >
                  {copiedId === msg.id ? (
                    <Check className="h-3 w-3 text-state-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => regenerateMessage(msg.id)}
                  title="Regenerate"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMessageFeedback(msg.id, msg.feedback === "like" ? null : "like")
                  }
                  title="Like"
                  className={`inline-flex h-6 w-6 items-center justify-center rounded hover:bg-surface-hover ${
                    msg.feedback === "like"
                      ? "text-state-success"
                      : "text-ink-muted hover:text-ink-primary"
                  }`}
                >
                  <ThumbsUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMessageFeedback(msg.id, msg.feedback === "dislike" ? null : "dislike")
                  }
                  title="Dislike"
                  className={`inline-flex h-6 w-6 items-center justify-center rounded hover:bg-surface-hover ${
                    msg.feedback === "dislike"
                      ? "text-state-danger"
                      : "text-ink-muted hover:text-ink-primary"
                  }`}
                >
                  <ThumbsDown className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {!noticeDismissed && messages.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-edge-subtle bg-surface-subtle/80 px-3 py-2 text-[11px]">
          <span className="text-ink-secondary">
            Context window at <strong className="font-semibold text-ink-primary">{capacityPct}%</strong> capacity for this session.
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => compactConversation(activeConversationId)}
              className="font-medium text-accent-fg hover:underline"
            >
              Compact history
            </button>
            <button
              type="button"
              onClick={dismissNotice}
              className="text-ink-muted hover:text-ink-primary"
              aria-label="Dismiss notice"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
