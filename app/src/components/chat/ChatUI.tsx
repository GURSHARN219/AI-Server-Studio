import React, { useRef, useEffect, useState, useMemo } from "react";
import {
  Paperclip,
  StopCircle,
  ArrowUp,
  X,
  HardDrive,
  Mic,
  Square,
  Loader2,
  ChevronDown,
  ChevronUp,
  Maximize2,
  PanelLeft,
  PanelRight,
  MoreHorizontal,
  Code2,
  Globe,
  Wrench,
  Check,
} from "lucide-react";
import { AgentProgressPanel } from "@/components/chat/AgentProgressPanel";
import JsonEditorTab from "@/components/JsonEditorTab";
import SessionsSidebar from "@/components/chat/SessionsSidebar";
import { useChatLogic } from "./useChatLogic";
import { AgentPicker } from "@/components/chat/sub-components/AgentPicker";
import { ModelPicker } from "@/components/chat/sub-components/ModelPicker";
import { MessageList } from "@/components/chat/sub-components/MessageList";
import { useSettingsStore } from "@/stores/settingsStore";
import { loadProviderModelPrefs } from "@/lib/providerModelPrefs";
import { sendBackendProviderTranscription } from "@/lib/api";
import { WorkspacePanel } from "@/components/studio/WorkspacePanel";
import { useStudioStore } from "@/stores/studioStore";

export function ChatUI(props: ReturnType<typeof useChatLogic>) {
  const {
    tabs, activeTab, setActiveTab,
    input, setInput, isGenerating, showModelPicker, setShowModelPicker,
    modelSearch, setModelSearch,
    attachedImages,
    sessionSearch, setSessionSearch,
    selectedAgent, setSelectedAgent, showAgentPicker, setShowAgentPicker,
    agentRunner,
    isFetchingModels,
    selectedModel, filteredTabs, messagesMap,
    activeTabData, messages, addNewTab, handleJsonSave,
    handleImageAttach, handlePaste, removeAttachedImage, handleSend, handleStop,
    handleKeyDown, handleModelChange, filteredModels, closeTab,
    formatTime, deleteMessage, handleRegenerate, fileInputRef, messagesEndRef,
    fetchAllModels, sessionsPanelOpen, providers, onOpenModelConfig, onEjectModel,
    onLoadModel, localModelLoading,
    tools = [], onToggleTool, renameTab, clearMessages, compactMessages,
  } = props;
  const { appearance, chat } = useSettingsStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const toolsPopoverRef = useRef<HTMLDivElement>(null);

  const [showNoModelBanner, setShowNoModelBanner] = useState(false);
  const noModelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSttRecording, setIsSttRecording] = useState(false);
  const [isSttTranscribing, setIsSttTranscribing] = useState(false);
  const [sttStatus, setSttStatus] = useState<string | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(activeTabData?.title || "New Chat");
  const [moreOpen, setMoreOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const [layoutMode, setLayoutMode] = useState<1 | 2 | 3>(() => {
    try { return Math.min(3, Math.max(1, Number(localStorage.getItem("chat-workspace-mode") || 1))) as 1 | 2 | 3; } catch { return 1; }
  });
  const [workspaceView, setWorkspaceView] = useState<"code" | "browser">(() => {
    try { return localStorage.getItem("chat-workspace-view") === "browser" ? "browser" : "code"; } catch { return "code"; }
  });
  const setStudioWorkspaceView = useStudioStore((s) => s.setWorkspaceView);
  const [popupExpanded, setPopupExpanded] = useState(() => {
    try { return localStorage.getItem("chat-workspace-popup-expanded") !== "false"; } catch { return true; }
  });
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [chatPanelWidth, setChatPanelWidth] = useState(() => {
    const defaultWidth = typeof window === "undefined" ? 600 : Math.min(700, Math.max(400, Math.round(window.innerWidth * 0.32)));
    try { return Math.min(700, Math.max(300, Number(localStorage.getItem("chat-workspace-chat-width-v2") || defaultWidth))); } catch { return defaultWidth; }
  });
  const chatResizeStart = useRef<{ x: number; width: number } | null>(null);
  const [narrowWindow, setNarrowWindow] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  const [narrowPane, setNarrowPane] = useState<"chat" | "workspace">("chat");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const sttChunksRef = useRef<BlobPart[]>([]);

  const activeToolsCount = tools.filter((t) => t.enabled).length;
  const activeTitle = activeTabData?.title || "New Chat";

  useEffect(() => {
    setTitleDraft(activeTitle);
    setEditingTitle(false);
  }, [activeTab, activeTitle]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
      if (toolsPopoverRef.current && !toolsPopoverRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    };
    window.addEventListener("mousedown", onOutside);
    return () => window.removeEventListener("mousedown", onOutside);
  }, []);

  const commitTitle = () => {
    setEditingTitle(false);
    if (titleDraft.trim()) {
      renameTab?.(activeTab, titleDraft);
    } else {
      setTitleDraft(activeTitle);
    }
  };

  const sttSelection = useMemo(() => {
    const rawKey = chat?.sttModelKey?.trim();
    if (rawKey) {
      const [providerId, ...rest] = rawKey.split("::");
      const modelId = rest.join("::");
      if (providerId && modelId) return { providerId, modelId };
    }

    const prefs = loadProviderModelPrefs();
    for (const [providerId, pref] of Object.entries(prefs)) {
      const modelId = pref.selections?.find((s) => s.modelType === "stt")?.modelId;
      if (modelId) return { providerId, modelId };
    }

    return null;
  }, [chat?.sttModelKey]);

  const sttProvider = useMemo(() => {
    if (!sttSelection) return null;
    return providers.find((p) => p.id === sttSelection.providerId) || null;
  }, [providers, sttSelection]);

  // Auto-latch: scroll to bottom while generating
  useEffect(() => {
    if (appearance.autoLatchGenerating && isGenerating) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isGenerating, appearance.autoLatchGenerating]);

  // Scroll to top on send
  const handleSendWithScroll = () => {
    if (layoutMode === 3) setPopupExpanded(true);
    if (appearance.scrollToTopOnSend && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    handleSend();
  };

  const triggerNoModelBanner = () => {
    setShowNoModelBanner(true);
    if (noModelTimerRef.current) clearTimeout(noModelTimerRef.current);
    noModelTimerRef.current = setTimeout(() => setShowNoModelBanner(false), 4000);
  };

  useEffect(() => () => { if (noModelTimerRef.current) clearTimeout(noModelTimerRef.current); }, []);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current = null;
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem("chat-workspace-mode", String(layoutMode)); localStorage.setItem("chat-workspace-view", workspaceView); localStorage.setItem("chat-workspace-popup-expanded", String(popupExpanded)); } catch { /* storage can be unavailable */ }
  }, [layoutMode, workspaceView, popupExpanded]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); setLayoutMode((mode) => mode === 3 ? 2 : mode === 2 ? 3 : 2); }
      if (event.ctrlKey && event.key.toLowerCase() === "j") {
        if (layoutMode === 3) { event.preventDefault(); setPopupExpanded((expanded) => !expanded); }
        else if (layoutMode === 2) { textareaRef.current?.focus(); }
      }
      if (event.key === "Escape" && layoutMode === 3 && popupExpanded) setPopupExpanded(false);
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [layoutMode, popupExpanded]);

  useEffect(() => {
    const resize = () => setNarrowWindow(window.innerWidth < 900);
    window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!chatResizeStart.current) return;
      setChatPanelWidth(Math.max(260, Math.min(620, chatResizeStart.current.width + event.clientX - chatResizeStart.current.x)));
    };
    const up = () => { chatResizeStart.current = null; };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);
  useEffect(() => { try { localStorage.setItem("chat-workspace-chat-width-v2", String(chatPanelWidth)); } catch {} }, [chatPanelWidth]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  const handleSttTranscription = async () => {
    if (!sttSelection) {
      setSttStatus("Select an STT model in Chat Settings");
      return;
    }
    if (!sttProvider || !sttProvider.baseUrl) {
      setSttStatus("Enable the STT provider in API Gateway → API Providers");
      return;
    }

    const blob = new Blob(sttChunksRef.current, { type: "audio/webm" });
    if (blob.size === 0) {
      setSttStatus("No audio captured");
      return;
    }

    const file = new File([blob], "recording.webm", { type: "audio/webm" });
    setIsSttTranscribing(true);
    setSttStatus("Transcribing...");

    try {
      const cleaned = await sendBackendProviderTranscription(sttSelection.providerId, sttSelection.modelId, file);
      if (cleaned) {
        setInput((prev) => (prev ? `${prev} ${cleaned}` : cleaned));
        setSttStatus("Transcription added");
      } else {
        setSttStatus("No speech detected");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setSttStatus(`Transcription failed: ${message}`);
    } finally {
      setIsSttTranscribing(false);
    }
  };

  const startSttRecording = async () => {
    if (isSttRecording || isSttTranscribing) return;
    sttChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) sttChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void handleSttTranscription();
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsSttRecording(true);
      setSttStatus("Recording...");
    } catch {
      setSttStatus("Microphone permission denied");
    }
  };

  const stopSttRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsSttRecording(false);
  };

  const headerTitle = isGenerating ? (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-pulse" />
      <span className="truncate text-muted-foreground text-[11px]">Running…</span>
    </span>
  ) : editingTitle ? (
    <input
      autoFocus
      aria-label="Rename conversation"
      value={titleDraft}
      onChange={(e) => setTitleDraft(e.target.value)}
      onBlur={commitTitle}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitTitle();
        if (e.key === "Escape") { setTitleDraft(activeTitle); setEditingTitle(false); }
      }}
      className="h-6 min-w-0 flex-1 max-w-[260px] rounded border border-primary bg-background px-1.5 text-xs font-semibold text-foreground focus:outline-none"
    />
  ) : (
    <button
      type="button"
      onClick={() => setEditingTitle(true)}
      title="Click to rename"
      className="min-w-0 truncate rounded px-1.5 py-0.5 text-left text-xs font-semibold text-foreground hover:bg-surface-hover"
    >
      {activeTitle}
    </button>
  );

  return (
    <div className="relative flex-1 flex h-full min-w-0 min-h-0 overflow-hidden">
      <SessionsSidebar
        isOpen={layoutMode === 1 && Boolean(sessionsPanelOpen)}
        tabs={tabs}
        filteredTabs={filteredTabs}
        activeTab={activeTab}
        sessionSearch={sessionSearch}
        onSessionSearchChange={setSessionSearch}
        onNewTab={addNewTab}
        onSelectTab={setActiveTab}
        onCloseTab={closeTab}
        messagesMap={messagesMap}
      />
      {layoutMode === 2 && historyDrawerOpen && (
        <div className="absolute inset-0 z-30" onClick={() => setHistoryDrawerOpen(false)}>
          <div className="absolute inset-0 bg-background/30" />
          <div className="absolute inset-y-0 left-0 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <SessionsSidebar
              isOpen
              tabs={tabs}
              filteredTabs={filteredTabs}
              activeTab={activeTab}
              sessionSearch={sessionSearch}
              onSessionSearchChange={setSessionSearch}
              onNewTab={addNewTab}
              onSelectTab={(id) => { setActiveTab(id); setHistoryDrawerOpen(false); }}
              onCloseTab={closeTab}
              messagesMap={messagesMap}
            />
          </div>
        </div>
      )}
      <div
        style={layoutMode === 2 ? { width: narrowWindow ? "100%" : `${chatPanelWidth}px` } : undefined}
        className={`flex flex-col min-w-0 min-h-0 overflow-hidden transition-[width,height] duration-200 ${
          layoutMode === 2
            ? `shrink-0 flex-none border-r border-border bg-background ${narrowWindow && narrowPane === "workspace" ? "hidden" : ""}`
            : layoutMode === 3
            ? `absolute bottom-3 left-1/2 z-20 w-[min(720px,calc(100%-24px))] -translate-x-1/2 rounded-xl border border-border bg-background shadow-2xl transition-[height] duration-300 ${popupExpanded ? "h-[min(70vh,720px)]" : "h-[140px]"}`
            : "flex-1 h-full"
        }`}
      >
        {layoutMode === 3 && popupExpanded && (
          <button
            type="button"
            onClick={() => setPopupExpanded((v) => !v)}
            className="flex h-5 shrink-0 items-center justify-center border-b border-border/60 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            title="Collapse chat (Ctrl+J)"
            aria-label="Collapse chat"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}

        {layoutMode === 3 && !popupExpanded && (
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-background px-3">
            <button
              type="button"
              onClick={() => setPopupExpanded(true)}
              title="Expand chat (Ctrl+J)"
              aria-label="Expand chat (Ctrl+J)"
              className="inline-flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border/80 bg-card px-3 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <img src="/logo.png" alt="" aria-hidden="true" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
              <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">Expand chat <span className="font-normal text-muted-foreground">(Ctrl+J)</span></span>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setLayoutMode(1)}
                title="Open full chat"
                aria-label="Open full chat"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode(2)}
                title="Open workspace panel"
                aria-label="Open workspace panel"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <PanelRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Slim Chat Header (Studio Workspace style) ── */}
        {(layoutMode !== 3 || popupExpanded) && <div
          ref={headerRef}
          className="relative flex h-8 shrink-0 items-center justify-between gap-1 border-b border-border/70 bg-background px-2"
        >
          {/* Left: sidebar toggle and editable title */}
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {layoutMode === 2 && (
              <button
                type="button"
                onClick={() => setHistoryDrawerOpen(true)}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                title="Sessions sidebar"
              >
                <PanelLeft className="h-3.5 w-3.5" />
              </button>
            )}

            {headerTitle}

          </div>

          {/* Right: … menu + workspace shortcuts/panel toggle + new chat */}
          <div className="flex shrink-0 items-center gap-0.5">
            {layoutMode === 2 && narrowWindow && (
              <button
                type="button"
                onClick={() => setNarrowPane("workspace")}
                className="mr-1 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                Workspace
              </button>
            )}

            {/* … More */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                title="More actions"
                aria-label="More actions"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-7 z-50 w-48 rounded-xl border border-border bg-popover p-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => { compactMessages?.(); setMoreOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-hover"
                  >
                    Compact history
                  </button>
                  <button
                    type="button"
                    onClick={() => { clearMessages?.(); setMoreOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-hover"
                  >
                    Clear messages
                  </button>
                </div>
              )}
            </div>

            {layoutMode === 1 && (
              <>
                <button
                  type="button"
                  onClick={() => { setWorkspaceView("code"); setStudioWorkspaceView("code"); setLayoutMode(2); }}
                  aria-label="Open code editor"
                  title="Open code editor"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                >
                  <Code2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => { setWorkspaceView("browser"); setStudioWorkspaceView("browser"); setLayoutMode(2); }}
                  aria-label="Open browser"
                  title="Open browser"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                >
                  <Globe className="h-3.5 w-3.5" />
                </button>
              </>
            )}

            {/* Panel toggle */}
            <button
              type="button"
              onClick={() =>
                layoutMode === 3
                  ? setLayoutMode(2)
                  : setLayoutMode(layoutMode === 1 ? 2 : 1)
              }
              title={
                layoutMode === 3
                  ? "Exit full view"
                  : layoutMode === 1
                  ? "Open workspace pane"
                  : "Close workspace pane"
              }
              aria-label={
                layoutMode === 3
                  ? "Exit full view"
                  : layoutMode === 1
                  ? "Open workspace pane"
                  : "Close workspace pane"
              }
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>

            {layoutMode === 2 && (
              <button
                type="button"
                onClick={() => setLayoutMode(3)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                title="Full view"
                aria-label="Full view"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            )}

          </div>
        </div>}

        {activeTabData?.type === "json-editor" && activeTabData.editorConfig && (
          <JsonEditorTab
            configType={activeTabData.editorConfig.configType}
            initialJson={activeTabData.editorConfig.json}
            onSave={(json) => handleJsonSave(activeTabData.editorConfig!.configType, json)}
          />
        )}

        {(!activeTabData || activeTabData.type === "chat") && (
          <div className={`flex flex-col min-w-0 min-h-0 overflow-hidden ${layoutMode === 3 ? "flex-1" : "flex-1 h-full"}`}>
            {(layoutMode !== 3 || popupExpanded) && (
              <div className="flex-1 min-w-0 min-h-0 overflow-y-auto scrollbar-thin flex flex-col" ref={scrollContainerRef}>
                <MessageList
                  messages={messages}
                  isGenerating={isGenerating}
                  selectedModel={selectedModel}
                  providers={providers}
                  messagesEndRef={messagesEndRef}
                  formatTime={formatTime}
                  deleteMessage={deleteMessage}
                  handleRegenerate={handleRegenerate}
                  onOpenFile={(file) => {
                    setWorkspaceView("code");
                    setStudioWorkspaceView("code");
                    try { localStorage.setItem("workspace:open-file", file); } catch {}
                    setLayoutMode(2);
                    window.dispatchEvent(new CustomEvent("workspace:open-file", { detail: { file } }));
                  }}
                />
              </div>
            )}

            <div className={`shrink-0 px-3 pt-2 ${layoutMode === 3 ? "pb-2" : "pb-4"}`}>
              <AgentProgressPanel events={agentRunner.events} status={agentRunner.status} />
              <div className="max-w-3xl mx-auto">
                {(layoutMode !== 3 || popupExpanded) && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setInput("Refactor the selected file for clarity and maintainability."); textareaRef.current?.focus(); }}
                      className="rounded-md border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground"
                    >
                      Refactor Code
                    </button>
                    <button
                      type="button"
                      onClick={() => { setWorkspaceView("browser"); setStudioWorkspaceView("browser"); setLayoutMode(2); if (narrowWindow) setNarrowPane("workspace"); }}
                      className="rounded-md border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground"
                    >
                      Open Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => { setInput("Explain the recent code changes in this workspace."); textareaRef.current?.focus(); }}
                      className="rounded-md border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground"
                    >
                      Explain Diff
                    </button>
                    <button
                      type="button"
                      onClick={() => { setInput("Review the API routes and check for potential issues."); textareaRef.current?.focus(); }}
                      className="rounded-md border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground"
                    >
                      Check Routes
                    </button>
                  </div>
                )}
                {showNoModelBanner && (
                  <div className="flex justify-center mb-2">
                    <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-hover border border-border/60 text-xs text-muted-foreground">
                      <HardDrive className="w-3 h-3 shrink-0 text-muted-foreground/70" />
                      <span className="text-[11px]">No model loaded</span>
                      <button
                        type="button"
                        onClick={() => onLoadModel?.(selectedModel?.id?.replace("local-", "") ?? "", selectedModel?.name ?? "", selectedModel?.path)}
                        className="px-2 py-0.5 rounded bg-surface-active hover:bg-border/60 text-foreground text-[11px] transition-colors border border-border/50 whitespace-nowrap"
                      >
                        Load model
                      </button>
                      <button type="button" onClick={() => setShowNoModelBanner(false)} className="p-0.5 hover:text-foreground transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-border/80 bg-background shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 focus-within:shadow-md transition-all">
                  {attachedImages.length > 0 && (
                    <div className="flex items-center gap-2 px-3 pt-2 pb-0 flex-wrap">
                      {attachedImages.map((img, i) => (
                        <div key={i} className="relative group/img">
                          <img src={img} alt={`Attached ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-border" />
                          <button
                            onClick={() => removeAttachedImage(i)}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                          >
                            <span className="text-[8px] leading-none">✕</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageAttach} />
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && selectedModel?.source === "local" && !props.runningLocalModel && !localModelLoading) {
                        e.preventDefault();
                        triggerNoModelBanner();
                        return;
                      }
                      handleKeyDown(e);
                    }}
                    onPaste={handlePaste}
                    placeholder={
                      selectedAgent.id === "plan" ? "What goal would you like to plan?" :
                      selectedAgent.id === "deep-research" ? "What do you want to research in depth?" :
                      selectedAgent.id === "guided-learning" ? "What topic would you like to learn about?" :
                      selectedAgent.id === "agent" ? "What should the agent do?" :
                      "Message…"
                    }
                    rows={1}
                    className="w-full bg-transparent text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/80 px-3 py-2 resize-none focus:outline-none min-h-[36px] max-h-[160px] overflow-y-auto scrollbar-styled"
                  />
                  <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-0.5 border-t border-border/40">
                    <div className="flex items-center gap-0.5 relative min-w-0 flex-1 flex-wrap">
                      <AgentPicker
                        selectedAgent={selectedAgent}
                        showAgentPicker={showAgentPicker}
                        setSelectedAgent={setSelectedAgent}
                        setShowAgentPicker={setShowAgentPicker}
                      />

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        title="Attach image"
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-surface-hover"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                      </button>

                      {/* Tools Popover (Studio Workspace style) */}
                      <div className="relative" ref={toolsPopoverRef}>
                        <button
                          type="button"
                          onClick={() => setToolsOpen((v) => !v)}
                          title="Tools"
                          aria-label="Tools"
                          className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                        >
                          <Wrench className="h-3.5 w-3.5" />
                          <span className="tabular-nums text-[11px] font-medium">{activeToolsCount}</span>
                        </button>
                        {toolsOpen && (
                          <div className="absolute bottom-8 left-0 z-40 w-64 rounded-lg border border-border bg-popover p-1.5 shadow-xl">
                            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                              Active Tools
                            </div>
                            {tools.length === 0 ? (
                              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                                No tools configured.
                              </div>
                            ) : (
                              tools.map((tool) => (
                                <button
                                  key={tool.id}
                                  type="button"
                                  onClick={() => onToggleTool?.(tool.id)}
                                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-xs font-medium text-foreground">{tool.name}</div>
                                    <div className="truncate text-[11px] text-muted-foreground">{tool.source}</div>
                                  </div>
                                  <span
                                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                                      tool.enabled
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border"
                                    }`}
                                  >
                                    {tool.enabled && <Check className="h-2.5 w-2.5" />}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      <ModelPicker
                        selectedModel={selectedModel}
                        showModelPicker={showModelPicker}
                        setShowModelPicker={setShowModelPicker}
                        modelSearch={modelSearch}
                        setModelSearch={setModelSearch}
                        filteredModels={filteredModels}
                        isFetchingModels={isFetchingModels}
                        fetchAllModels={fetchAllModels}
                        handleModelChange={handleModelChange}
                        onOpenModelConfig={onOpenModelConfig}
                        onEjectModel={onEjectModel}
                        onLoadModel={onLoadModel}
                        runningLocalModel={props.runningLocalModel}
                        localModelLoading={localModelLoading}
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={isSttRecording ? stopSttRecording : startSttRecording}
                        disabled={isSttTranscribing}
                        title={sttStatus || "STT"}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-1 py-2 text-[11px] font-semibold transition-all ${
                          isSttRecording
                            ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
                            : "border-border/70 bg-background text-muted-foreground hover:text-foreground"
                        } ${isSttTranscribing ? "opacity-70 cursor-not-allowed" : "hover:bg-background/70"}`}
                      >
                        {isSttTranscribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        {!isSttTranscribing && isSttRecording ? <Square className="w-3.5 h-3.5" fill="currentColor" /> : null}
                        {!isSttTranscribing && !isSttRecording ? <Mic className="w-3.5 h-3.5" /> : null}
                      </button>

                      {isGenerating || agentRunner.status === "running" || agentRunner.status === "planning" ? (
                        <button
                          onClick={() => { handleStop(); agentRunner.abortAgent(); }}
                          className="p-2 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all"
                        >
                          <StopCircle className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (selectedModel?.source === "local" && !props.runningLocalModel && !localModelLoading) {
                              triggerNoModelBanner();
                              return;
                            }
                            handleSendWithScroll();
                          }}
                          disabled={!input.trim() && attachedImages.length === 0}
                          className="p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {layoutMode === 2 && !narrowWindow && (
        <div
          role="separator"
          aria-label="Resize chat panel"
          aria-orientation="vertical"
          aria-valuenow={chatPanelWidth}
          tabIndex={0}
          onPointerDown={(event) => {
            chatResizeStart.current = { x: event.clientX, width: chatPanelWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setChatPanelWidth((width) => Math.max(260, width - 16));
            if (event.key === "ArrowRight") setChatPanelWidth((width) => Math.min(620, width + 16));
          }}
          className="group z-10 flex w-3 shrink-0 cursor-col-resize touch-none items-stretch justify-center bg-transparent transition-colors hover:bg-primary/5 focus-visible:bg-primary/10"
        >
          <div className="h-full w-px bg-border/70 transition-colors group-hover:bg-primary/70" />
        </div>
      )}
      {(layoutMode === 2 || layoutMode === 3) && (
        <div className={`flex min-w-0 min-h-0 flex-1 ${layoutMode === 2 && narrowWindow && narrowPane === "chat" ? "hidden" : ""}`}>
          <WorkspacePanel />
        </div>
      )}
    </div>
  );
}
