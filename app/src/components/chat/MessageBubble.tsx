import React, { useState } from "react";
import {
  ChevronRight, RotateCcw, Copy, Sparkles, Loader2, Trash2, Square,
  Check, AlertCircle, Wrench, Brain, Clock, Activity, Database, Globe,
  Link, Search, BookOpen, Code2, ChevronDown, ExternalLink, FileText, Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import CodeBlock from "./CodeBlock";
import type { Message } from "./types";
import { useSettingsStore } from "@/stores/settingsStore";

interface MessageBubbleProps {
  message: Message;
  isGenerating: boolean;
  isLastAssistant?: boolean;
  formatTime: (ts: number) => string;
  onDelete: () => void;
  onRegenerate: () => void;
  onOpenFile?: (file: string) => void;
}

function MessageBubbleInner({
  message, isGenerating, isLastAssistant = false, formatTime, onDelete, onRegenerate, onOpenFile,
}: MessageBubbleProps) {
  const { appearance } = useSettingsStore();
  const [thinkingOpen, setThinkingOpen] = useState(appearance.expandReasoningByDefault);
  const [copied, setCopied] = useState(false);
  const [showLlamaSpeed, setShowLlamaSpeed] = useState(false);
  const mentionedFiles = React.useMemo(() => [...new Set(message.content.match(/(?:[\w.-]+\/)*[\w.-]+\.(?:tsx?|jsx?|css|json|md|html)/g) || [])].slice(0, 3), [message.content]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (message.role === "user") {
    return (
      <div className="flex justify-end gap-2 items-end group">
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity mb-1">
          <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="w-3 h-3" />
          </button>
          <button onClick={handleCopy} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <Copy className="w-3 h-3" />
          </button>
        </div>
        <span className="text-[10px] text-muted-foreground mb-1 shrink-0">{formatTime(message.timestamp)}</span>
        <div className="max-w-lg">
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5 justify-end">
              {message.images.map((img, i) => (
                <img key={i} src={img} alt={`Uploaded ${i + 1}`} className="max-w-[200px] max-h-[200px] rounded-xl object-cover border border-border" />
              ))}
            </div>
          )}
          {message.content && (
            <div className="bg-user-bubble text-primary-foreground px-4 py-2.5 rounded-2xl rounded-br-md text-sm whitespace-pre-wrap leading-relaxed">
              {message.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (message.error) {
    return (
      <div className="flex gap-3">
        <div className="w-6 h-6 rounded-md bg-destructive/20 flex items-center justify-center shrink-0 mt-0.5">
          <AlertCircle className="w-3.5 h-3.5 text-destructive" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            {message.modelName && <span className="text-[11px] text-muted-foreground font-mono">{message.modelName}</span>}
            <span className="text-[10px] text-muted-foreground">{formatTime(message.timestamp)}</span>
          </div>
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
            <p className="text-xs font-medium text-destructive">Error</p>
            <p className="text-[11px] text-destructive/80 mt-0.5">{message.error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 group">
      <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          {message.modelName && <span className="text-[11px] font-semibold text-foreground">{message.modelName}</span>}
          {message.timestamp && <span className="text-[10px] text-muted-foreground">{formatTime(message.timestamp)}</span>}
        </div>

        {(message.thinkingTime != null || (message.thinkingContent != null && (message.thinkingContent !== "" || isGenerating))) && (
          <div className={`mt-1 mb-2 rounded-xl border border-border/50 overflow-hidden max-w-[85%] ${appearance.showReasoningVignette ? "bg-secondary/30" : "bg-transparent"}`}>
            <button onClick={() => setThinkingOpen(!thinkingOpen)} className="flex items-center justify-between w-full px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors bg-secondary/20 hover:bg-secondary/40">
              <div className="flex items-center gap-2 text-foreground/80">
                {message.thinkingTime == null ? (<><Brain className="w-3.5 h-3.5 animate-pulse text-primary/70" /><Loader2 className="w-3 h-3 animate-spin text-primary/60" /></>) : (<Brain className="w-3.5 h-3.5 text-muted-foreground/80" />)}
                <span>Reasoning</span>
                {message.thinkingTime != null && <span className="text-[10px] text-muted-foreground/60">{message.thinkingTime}s</span>}
              </div>
              <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/60 transition-transform ${thinkingOpen ? "rotate-90" : ""}`} />
            </button>
            {thinkingOpen && message.thinkingContent && (
              <div className="px-3.5 py-3 text-xs text-muted-foreground/90 italic border-t border-border/50 scrollbar-thin overflow-y-auto max-h-96 whitespace-pre-wrap leading-relaxed bg-black/10">
                {message.thinkingContent}
              </div>
            )}
          </div>
        )}

        {/* CHANGED: Individual tool call cards instead of one collapsed box */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallCards toolCalls={message.toolCalls} isGenerating={isGenerating} />
        )}

        {message.content && (
          <div className="text-sm text-foreground leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-2 prose-p:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-foreground prose-strong:text-foreground prose-strong:font-semibold prose-blockquote:border-l-2 prose-blockquote:border-primary/30 prose-blockquote:pl-3 prose-blockquote:text-muted-foreground"
            style={{ fontSize: "var(--chat-font-size)", fontWeight: "var(--chat-font-weight)" }}>
            {appearance.viewMode === "plain" ? (
              <span className="whitespace-pre-wrap">{message.content}</span>
            ) : (
              <ReactMarkdown components={{ code: ({ children, className }) => <CodeBlock className={className}>{children}</CodeBlock>, pre: ({ children }) => <>{children}</> }}>
                {message.content}
              </ReactMarkdown>
            )}
            {isGenerating && <span className="inline-block w-0.5 h-4 bg-primary animate-blink ml-0.5 align-text-bottom" />}
          </div>
        )}
        {mentionedFiles.length > 0 && <div className="flex flex-wrap gap-1.5">{mentionedFiles.map((file) => <button key={file} onClick={() => onOpenFile?.(file)} className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/40 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground"><FileText className="h-3 w-3"/><span>Edited {file}</span><ExternalLink className="h-2.5 w-2.5 opacity-60"/></button>)}</div>}

        {!isGenerating && message.content && (
          <div className="flex items-center gap-6 mt-2 mb-1">
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={onRegenerate} className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-surface-hover" title="Regenerate">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleCopy} className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-surface-hover" title="Copy">
                {copied ? <Check className="w-3.5 h-3.5 text-status-online" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded hover:bg-surface-hover" title="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {message.tokensCount != null && message.generationTime != null && message.speed != null && (() => {
              const show = appearance.showGenInfo === "all" || (appearance.showGenInfo === "last" && isLastAssistant && !isGenerating);
              if (!show) return null;
              return (
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground/70 font-mono tracking-tight">
                  <span className="flex items-center gap-1.5" title="Tokens generated"><Database className="w-3.5 h-3.5 text-muted-foreground/60" />{message.tokensCount} tokens</span>
                  <span className="flex items-center gap-1.5" title="Generation time"><Clock className="w-3.5 h-3.5 text-muted-foreground/60" />{message.generationTime}s</span>
                  <button onClick={() => setShowLlamaSpeed(!showLlamaSpeed)} className="flex items-center gap-1.5 hover:text-foreground transition-colors" title="Toggle App/Llama.cpp Speed">
                    <Activity className="w-3.5 h-3.5 text-muted-foreground/60" />
                    {showLlamaSpeed && message.llamaSpeed != null ? `${message.llamaSpeed} t/s (llama)` : `${message.speed} t/s`}
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {!message.content && isGenerating && !message.error && message.thinkingContent == null && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
            <span>Generating...</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tool icon by name ─────────────────────────────────────────────────────────
function getToolIcon(name: string): React.ReactNode {
  const n = name.toLowerCase();
  if (n.includes("search") || n === "web.search") return <Search className="w-3.5 h-3.5" />;
  if (n.includes("fetch") || n.includes("url") || n === "web.fetch") return <Globe className="w-3.5 h-3.5" />;
  if (n.includes("kb") || n.includes("knowledge")) return <BookOpen className="w-3.5 h-3.5" />;
  if (n.includes("sandbox") || n.includes("code") || n.includes("js") || n.includes("python")) return <Code2 className="w-3.5 h-3.5" />;
  if (n.includes("file") || n.includes("doc") || n.includes("read")) return <FileText className="w-3.5 h-3.5" />;
  if (n.includes("run") || n.includes("exec") || n.includes("compute")) return <Zap className="w-3.5 h-3.5" />;
  return <Wrench className="w-3.5 h-3.5" />;
}

function getToolColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("search") || n === "web.search") return "text-blue-400";
  if (n.includes("fetch") || n.includes("url") || n === "web.fetch") return "text-violet-400";
  if (n.includes("kb") || n.includes("knowledge")) return "text-amber-400";
  if (n.includes("sandbox") || n.includes("code")) return "text-emerald-400";
  return "text-primary";
}

function getToolArgSummary(name: string, args: string): string {
  try {
    const a = JSON.parse(args);
    if (a.query) return `"${String(a.query).slice(0, 60)}${String(a.query).length > 60 ? "\u2026" : ""}"`;
    if (a.url) return String(a.url).slice(0, 70) + (String(a.url).length > 70 ? "\u2026" : "");
    if (a.action) return String(a.action);
    if (a.code) return "run code";
    if (a.command) return String(a.command).slice(0, 50);
    const keys = Object.keys(a);
    if (keys.length > 0) return `${keys[0]}: ${String(a[keys[0]]).slice(0, 40)}`;
  } catch { /* ignore */ }
  return "";
}

function SearchResultCards({ result, expanded }: { result: string; expanded: boolean }) {
  try {
    const parsed = JSON.parse(result);
    const results: { title: string; url: string; snippet: string }[] = parsed.results || [];
    if (results.length === 0) return null;
    const visible = expanded ? results : results.slice(0, 3);
    return (
      <div className="space-y-1.5">
        {visible.map((r, i) => (
          <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
            className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white/5 transition-colors group/link">
            <div className="w-4 h-4 rounded bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
              <Link className="w-2.5 h-2.5 text-primary/60" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-primary font-medium truncate group-hover/link:underline">{r.title}</div>
              <div className="text-[9px] text-muted-foreground/60 truncate">{r.url}</div>
              {r.snippet && <div className="text-[10px] text-foreground/60 mt-0.5 line-clamp-2">{r.snippet}</div>}
            </div>
            <ExternalLink className="w-3 h-3 text-muted-foreground/30 shrink-0 mt-0.5 opacity-0 group-hover/link:opacity-100 transition-opacity" />
          </a>
        ))}
      </div>
    );
  } catch { return null; }
}

function ToolResultContent({ name, result, expanded }: { name: string; result: string; expanded: boolean }) {
  const n = name.toLowerCase();
  const isError = result.startsWith("Error:") || result.startsWith("Blocked:") || result.startsWith("MCP Error");
  if (isError) return <span className="text-[11px] text-destructive">{result}</span>;
  if (n.includes("search")) {
    const el = <SearchResultCards result={result} expanded={expanded} />;
    if (el) return el;
  }
  if (n.includes("fetch") || n.includes("url")) {
    try {
      const parsed = JSON.parse(result);
      if (parsed.url || parsed.title) {
        return (
          <div className="space-y-1">
            {parsed.title && <div className="text-[11px] text-foreground font-medium">{parsed.title}</div>}
            {parsed.url && (
              <a href={parsed.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary truncate">
                <Link className="w-3 h-3 shrink-0" />{parsed.url}
              </a>
            )}
            {parsed.content && <div className="text-[10px] text-foreground/60 line-clamp-4 mt-0.5">{parsed.content.slice(0, 400)}{parsed.content.length > 400 ? "\u2026" : ""}</div>}
          </div>
        );
      }
    } catch { /* fall through */ }
  }
  return (
    <pre className={`text-[10px] font-mono text-foreground/70 whitespace-pre-wrap break-all leading-relaxed ${!expanded ? "line-clamp-5" : ""}`}>
      {result}
    </pre>
  );
}

// ── Single tool call card ─────────────────────────────────────────────────────
function ToolCallCard({ tool, index }: { tool: NonNullable<Message["toolCalls"]>[number]; index: number }) {
  const developerMode = useSettingsStore(s => s.advanced.developerMode);
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const argSummary = getToolArgSummary(tool.name, tool.args);
  const isError = tool.result?.startsWith("Error:") || tool.result?.startsWith("Blocked:") || tool.result?.startsWith("MCP Error") || tool.status === "error";
  const hasResult = !!(tool.result && tool.status === "done");
  const errorText = (tool.error || tool.result || "Unknown tool error").trim();
  const isRunning = tool.status === "running";
  const isDone = tool.status === "done";
  const resultLen = tool.result?.length ?? 0;
  const resultLines = tool.result?.split("\n").length ?? 0;
  const canExpand = hasResult && !isError && (resultLines > 5 || resultLen > 300);

  return (
    <div className={`relative rounded-xl border transition-all duration-200 ${
      isRunning ? "border-primary/30 bg-primary/5" :
      isError ? "border-destructive/25 bg-destructive/5" :
      isDone ? "border-border/50 bg-secondary/20" :
      "border-border/30 bg-transparent"
    }`}>
      {isRunning && (
        <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl overflow-hidden bg-primary/20">
          <div className="h-full w-1/2 bg-primary/60 animate-[ping_1.5s_ease-in-out_infinite] rounded-full" />
        </div>
      )}
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer hover:bg-white/5 transition-colors rounded-xl"
      >
        <span className={`shrink-0 ${isRunning ? "text-primary" : isError ? "text-destructive" : isDone ? "text-emerald-400" : "text-muted-foreground/40"}`}>
          {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
           isError ? <AlertCircle className="w-3.5 h-3.5" /> :
           isDone ? <Check className="w-3.5 h-3.5" /> :
           <Square className="w-3.5 h-3.5" />}
        </span>
        <span className={`shrink-0 ${getToolColor(tool.name)}`}>{getToolIcon(tool.name)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-foreground/90 font-mono">{tool.name}</span>
            {argSummary && <span className="text-[11px] text-muted-foreground/60 truncate">{"\u2014"} {argSummary}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {tool.duration != null && <span className="text-[9px] text-muted-foreground/50 font-mono">{tool.duration}ms</span>}
          {isRunning && <span className="text-[9px] text-primary/60 animate-pulse">running</span>}
          <ChevronDown className={`w-3 h-3 text-muted-foreground/40 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </button>

      {isOpen && (
        <div className={`px-3 pb-2.5 border-t ${isError ? "border-destructive/20" : "border-border/30"} bg-black/10 rounded-b-xl`}>
          <div className="pt-2">
            {developerMode && (
              <>
                <div className="text-[10px] text-muted-foreground/80 mb-1">Arguments:</div>
                <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap break-all leading-relaxed mb-3 p-2 bg-black/20 rounded-md border border-border/20">
                  {tool.args}
                </pre>
              </>
            )}
            
            {hasResult && (
              <>
                <div className="text-[10px] text-muted-foreground/80 mb-1">Result:</div>
                <div className="p-2 bg-black/20 rounded-md border border-border/20 overflow-x-auto">
                  <ToolResultContent name={tool.name} result={tool.result!} expanded={expanded} />
                </div>
              </>
            )}
            {isError && (
              <>
                <div className="text-[10px] text-destructive mb-1">Error:</div>
                <div className="p-2 bg-destructive/10 rounded-md border border-destructive/20 overflow-x-auto">
                  <pre className="text-[10px] font-mono text-destructive whitespace-pre-wrap break-all leading-relaxed">
                    {errorText}
                  </pre>
                </div>
              </>
            )}
          </div>
          {canExpand && (
            <button onClick={() => setExpanded(v => !v)} className="mt-2 text-[10px] text-primary/60 hover:text-primary flex items-center gap-0.5 transition-colors font-medium">
              <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {isRunning && !isOpen && (
        <div className="px-3 pb-2.5">
          <div className="flex gap-1 items-center">
            {[0, 1, 2].map(i => (
              <span key={i} className="w-1 h-1 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
            <span className="text-[10px] text-muted-foreground/50 ml-1">Running\u2026</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tool call cards container ─────────────────────────────────────────────────
function ToolCallCards({ toolCalls, isGenerating }: { toolCalls: NonNullable<Message["toolCalls"]>; isGenerating: boolean }) {
  const [allCollapsed, setAllCollapsed] = useState(false);
  const totalDone = toolCalls.filter(t => t.status === "done" || t.status === "error").length;
  const allFinished = totalDone === toolCalls.length && toolCalls.length > 0;

  if (toolCalls.length === 0) return null;

  return (
    <div className="my-2 space-y-1.5 max-w-[90%]">
      {allFinished && toolCalls.length > 1 && (
        <button onClick={() => setAllCollapsed(v => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-1">
          <ChevronDown className={`w-3 h-3 transition-transform ${allCollapsed ? "-rotate-90" : ""}`} />
          <Check className="w-3 h-3 text-emerald-400" />
          <span>Used {toolCalls.length} tool{toolCalls.length > 1 ? "s" : ""}</span>
        </button>
      )}

      {!allCollapsed && (
        <div className="space-y-1.5">
          {toolCalls.map((tool, i) => <ToolCallCard key={tool.id || i} tool={tool} index={i} />)}
        </div>
      )}

      {allCollapsed && allFinished && (
        <div className="flex flex-wrap gap-1.5">
          {toolCalls.map((tool, i) => (
            <button key={tool.id || i} onClick={() => setAllCollapsed(false)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/40 bg-secondary/30 hover:bg-secondary/50 transition-colors text-[10px] text-muted-foreground hover:text-foreground">
              <span className={getToolColor(tool.name)}>{getToolIcon(tool.name)}</span>
              <span className="font-mono">{tool.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MessageBubble = React.memo(MessageBubbleInner);
export default MessageBubble;
