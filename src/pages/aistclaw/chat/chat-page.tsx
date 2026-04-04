import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { Eye, PanelLeftOpen } from "lucide-react";
import { useAuthStore } from "@aistclaw/stores/use-auth-store";
import { useIsMobile } from "@aistclaw/hooks/use-media-query";
import { cn } from "@aistclaw/lib/utils";
import { ChatSidebar } from "./chat-sidebar";
import { ChatThread } from "./chat-thread";
import { ChatInput, type AttachedFile } from "@aistclaw/components/chat/chat-input";
import { ChatTopBar } from "@aistclaw/components/chat/chat-top-bar";
import { DropZone } from "@aistclaw/components/chat/drop-zone";
import { AgentPickerPrompt } from "@aistclaw/components/chat/agent-picker-prompt";
import { useChatSessions } from "./hooks/use-chat-sessions";
import { useChatMessages } from "./hooks/use-chat-messages";
import { useChatSend } from "./hooks/use-chat-send";
import { isOwnSession, parseSessionKey } from "@aistclaw/lib/session-key";
import { useVirtualKeyboard } from "@aistclaw/hooks/use-virtual-keyboard";
import { TaskPanel } from "@aistclaw/components/chat/task-panel";
import { ROUTES } from "@aistclaw/lib/constants";

export function ChatPage() {
  const { t } = useTranslation("chat");
  const { sessionKey: urlSessionKey } = useParams<{ sessionKey: string }>();
  const navigate = useNavigate();
  const connected = useAuthStore((s) => s.connected);
  const userId = useAuthStore((s) => s.userId);

  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [files, setFiles] = useState<AttachedFile[]>([]);

  // sessionKey derived from URL — single source of truth, no separate state
  const sessionKey = urlSessionKey ?? "";

  // Fallback agent ID used only when URL has no session key
  const [agentIdFallback, setAgentIdFallback] = useState("");

  // Agent is confirmed when URL has a session (agentId parsed) or user explicitly picked one
  const agentConfirmed = !!urlSessionKey || !!agentIdFallback;

  // Derive agentId from URL (source of truth), fallback to state when no session
  const agentId = useMemo(() => {
    if (urlSessionKey) {
      const { agentId: parsed } = parseSessionKey(urlSessionKey);
      if (parsed) return parsed;
    }
    return agentIdFallback;
  }, [urlSessionKey, agentIdFallback]);

  const {
    sessions,
    loading: sessionsLoading,
    refresh: refreshSessions,
    buildNewSessionKey,
    deleteSession,
  } = useChatSessions(agentId);

  const {
    messages,
    streamText,
    thinkingText,
    toolStream,
    isRunning,
    isBusy,
    loading: messagesLoading,
    activity,
    blockReplies,
    teamTasks,
    expectRun,
    addLocalMessage,
  } = useChatMessages(sessionKey, agentId);

  // Refresh sessions when all work completes (main agent + team tasks)
  const prevIsBusyRef = useRef(false);
  useEffect(() => {
    if (prevIsBusyRef.current && !isBusy) {
      refreshSessions();
    }
    prevIsBusyRef.current = isBusy;
  }, [isBusy, refreshSessions]);

  const isOwn = !sessionKey || isOwnSession(sessionKey, userId);

  const handleMessageAdded = useCallback(
    (msg: { role: "user" | "assistant" | "tool"; content: string; timestamp?: number }) => {
      addLocalMessage(msg);
    },
    [addLocalMessage],
  );

  const { send, abort, error: sendError } = useChatSend({
    agentId,
    onMessageAdded: handleMessageAdded,
    onExpectRun: expectRun,
  });

  const handleNewChat = useCallback(() => {
    navigate(`${ROUTES.CHAT}/${encodeURIComponent(buildNewSessionKey())}`);
  }, [buildNewSessionKey, navigate]);

  const handleSessionSelect = useCallback(
    (key: string) => {
      const { agentId: parsed } = parseSessionKey(key);
      if (parsed) setAgentIdFallback(parsed);
      navigate(`${ROUTES.CHAT}/${encodeURIComponent(key)}`);
    },
    [navigate],
  );

  const handleDeleteSession = useCallback(async (key: string) => {
    await deleteSession(key);
    if (key === sessionKey) {
      const next = sessions.find((s) => s.key !== key);
      if (next) {
        handleSessionSelect(next.key);
      } else {
        handleNewChat();
      }
    }
  }, [deleteSession, sessionKey, sessions, handleSessionSelect, handleNewChat]);

  const handleAgentChange = useCallback(
    (newAgentId: string) => {
      setAgentIdFallback(newAgentId);
      if (sessionKey) {
        navigate(ROUTES.CHAT);
      }
    },
    [navigate, sessionKey],
  );

  const handleSend = useCallback(
    (message: string, sendFiles?: AttachedFile[]) => {
      let key = sessionKey;
      if (!key) {
        key = buildNewSessionKey();
        navigate(`${ROUTES.CHAT}/${encodeURIComponent(key)}`, { replace: true });
      }
      send(message, key, sendFiles);
      setScrollTrigger((n) => n + 1);
    },
    [sessionKey, send, buildNewSessionKey, navigate],
  );

  const handleDropFiles = useCallback((dropped: File[]) => {
    setFiles((prev) => [...prev, ...dropped.map((f) => ({ file: f }))]);
  }, []);

  const handleAbort = useCallback(() => {
    abort(sessionKey);
  }, [abort, sessionKey]);

  const isMobile = useIsMobile();
  useVirtualKeyboard();
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);

  // Auto-open task panel when first task appears, auto-close when all done.
  const prevTaskCountRef = useRef(0);
  useEffect(() => {
    const prev = prevTaskCountRef.current;
    const curr = teamTasks.length;
    if (prev === 0 && curr > 0) setTaskPanelOpen(true);
    if (curr === 0 && prev > 0) setTaskPanelOpen(false);
    prevTaskCountRef.current = curr;
  }, [teamTasks.length]);

  const handleSessionSelectMobile = useCallback(
    (key: string) => {
      handleSessionSelect(key);
      setChatSidebarOpen(false);
    },
    [handleSessionSelect],
  );

  const handleNewChatMobile = useCallback(() => {
    handleNewChat();
    setChatSidebarOpen(false);
  }, [handleNewChat]);

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Chat Sidebar */}
      {isMobile ? (
        <>
          {chatSidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50"
              onClick={() => setChatSidebarOpen(false)}
            />
          )}
          <div
            className={cn(
              "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out",
              chatSidebarOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            <ChatSidebar
              agentId={agentId}
              onAgentChange={handleAgentChange}
              sessions={sessions}
              sessionsLoading={sessionsLoading}
              activeSessionKey={sessionKey}
              onSessionSelect={handleSessionSelectMobile}
              onDeleteSession={handleDeleteSession}
              onNewChat={handleNewChatMobile}
            />
          </div>
        </>
      ) : (
        <ChatSidebar
          agentId={agentId}
          onAgentChange={handleAgentChange}
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          activeSessionKey={sessionKey}
          onSessionSelect={handleSessionSelect}
          onDeleteSession={handleDeleteSession}
          onNewChat={handleNewChat}
        />
      )}

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 min-h-0 flex-col">
        {isMobile && (
          <div className="flex shrink-0 items-center border-b px-3 py-2 landscape-compact">
            <button
              onClick={() => setChatSidebarOpen(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title={t("openSessions")}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="shrink-0">
          <ChatTopBar agentId={agentId} isRunning={isRunning} isBusy={isBusy} activity={activity} teamTasks={teamTasks} onToggleTaskPanel={() => setTaskPanelOpen((v) => !v)} taskPanelOpen={taskPanelOpen} />
        </div>

        {sendError && (
          <div className="shrink-0 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {sendError}
          </div>
        )}

        <DropZone onDrop={handleDropFiles}>
          <ChatThread
            messages={messages}
            streamText={streamText}
            thinkingText={thinkingText}
            toolStream={toolStream}
            blockReplies={blockReplies}
            activity={activity}
            teamTasks={teamTasks}
            isRunning={isRunning}
            isBusy={isBusy}
            loading={messagesLoading}
            scrollTrigger={scrollTrigger}
            onToggleTaskPanel={() => setTaskPanelOpen((v) => !v)}
          />

          {!agentConfirmed && messages.length === 0 && (
            <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-background/50 backdrop-blur-[2px]">
              <AgentPickerPrompt onSelect={handleAgentChange} />
            </div>
          )}

          {!isOwn ? (
            <div className="mx-auto mb-6 flex max-w-2xl items-center gap-3 rounded-2xl border bg-muted/30 backdrop-blur-md px-4 py-3 text-sm text-muted-foreground shadow-sm shrink-0">
              <Eye className="h-4 w-4" />
              {t("readOnly")}
            </div>
          ) : (
            <div className="sticky bottom-0 z-20 w-full pt-8 pb-0 bg-gradient-to-t from-background via-background/90 to-transparent shrink-0">
              {!agentConfirmed && messages.length > 0 && (
                <div className="mx-auto max-w-3xl px-4 mb-4">
                  <AgentPickerPrompt onSelect={handleAgentChange} compact />
                </div>
              )}
              <ChatInput
                onSend={handleSend}
                onAbort={handleAbort}
                isBusy={isBusy}
                disabled={!connected || !agentConfirmed}
                placeholder={!agentConfirmed ? t("selectAgent.description") : undefined}
                helperText={!agentConfirmed ? t("selectAgent.description") : undefined}
                files={files}
                onFilesChange={setFiles}
              />
            </div>
          )}
        </DropZone>
      </div>

      {/* Mobile overlay backdrop — must render before TaskPanel so panel sits above */}
      {isMobile && taskPanelOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setTaskPanelOpen(false)} />
      )}

      {/* Task panel — toggleable sidebar on the right */}
      <TaskPanel tasks={teamTasks} open={taskPanelOpen} onClose={() => setTaskPanelOpen(false)} />
    </div>
  );
}
