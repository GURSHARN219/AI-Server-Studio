import React, { useRef, useEffect, useState, useMemo } from "react";
import { Wrench, Database, Paperclip, StopCircle, ArrowUp, X, HardDrive, Mic, Square, Loader2 } from "lucide-react";
import { AgentProgressPanel } from "@/components/chat/AgentProgressPanel";
import JsonEditorTab from "@/components/JsonEditorTab";
import SessionsSidebar from "@/components/chat/SessionsSidebar";
import { useChatLogic } from "./useChatLogic";
import { AgentPicker } from "@/components/chat/sub-components/AgentPicker";
import { ModelPicker } from "@/components/chat/sub-components/ModelPicker";
import { ToolConfigPanel } from "@/components/chat/sub-components/ToolConfigPanel";
import { McpServersPanel } from "@/components/chat/sub-components/McpServersPanel";
import { MessageList } from "@/components/chat/sub-components/MessageList";
import { useSettingsStore } from "@/stores/settingsStore";
import { loadProviderModelPrefs } from "@/lib/providerModelPrefs";
import { sendBackendProviderTranscription } from "@/lib/api";

export function ChatUI(props: ReturnType<typeof useChatLogic>) {
  const {
    tabs, activeTab, setActiveTab,
    input, setInput, isGenerating, showModelPicker, setShowModelPicker,
    modelSearch, setModelSearch,
    showToolConfig, setShowToolConfig, showMcpServers, setShowMcpServers,
    showAddTool, setShowAddTool, showAddMcp, setShowAddMcp,
    newToolName, setNewToolName, newToolSource, setNewToolSource,
    newMcpName, setNewMcpName, newMcpUrl, setNewMcpUrl,
    mcpServers, toolConfigs,
    attachedImages,
    sessionSearch, setSessionSearch,
    selectedAgent, setSelectedAgent, showAgentPicker, setShowAgentPicker,
    agentRunner,
    selectedProviderId,
    isFetchingModels,
    selectedModel, filteredTabs, messagesMap,
    activeTabData, messages, addNewTab, openJsonEditor, handleJsonSave,
    handleImageAttach, handlePaste, removeAttachedImage, handleSend, handleStop,
    handleKeyDown, handleModelChange, filteredModels, closeTab, handleAddTool,
    handleAddMcp, removeMcp, toggleMcpEnabled, removeToolConfig, toggleToolConfig,
    formatTime, deleteMessage, handleRegenerate, fileInputRef, messagesEndRef,
    fetchAllModels, sessionsPanelOpen, providers, onOpenModelConfig, onEjectModel,
    onLoadModel, localModelLoading
  } = props;
  const { appearance, chat } = useSettingsStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showNoModelBanner, setShowNoModelBanner] = useState(false);
  const noModelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSttRecording, setIsSttRecording] = useState(false);
  const [isSttTranscribing, setIsSttTranscribing] = useState(false);
  const [sttStatus, setSttStatus] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const sttChunksRef = useRef<BlobPart[]>([]);

  const sttSelection = useMemo(() => {
    const rawKey = chat.sttModelKey?.trim();
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
  }, [chat.sttModelKey]);

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
      setSttStatus("Enable the STT provider in Settings → API Providers");
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

  return (
    <div className="flex-1 flex h-full min-w-0">
      <SessionsSidebar
        isOpen={sessionsPanelOpen}
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
      <div className="flex-1 flex flex-col h-full min-w-0">
        {activeTabData?.type === "json-editor" && activeTabData.editorConfig && (
          <JsonEditorTab
            configType={activeTabData.editorConfig.configType}
            initialJson={activeTabData.editorConfig.json}
            onSave={(json) => handleJsonSave(activeTabData.editorConfig!.configType, json)}
          />
        )}

        {(!activeTabData || activeTabData.type === "chat") && (
          <div className="flex-1 flex flex-col h-full min-h-0">
            <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col" ref={scrollContainerRef}>
              <MessageList
                messages={messages}
                isGenerating={isGenerating}
                selectedModel={selectedModel}
                providers={providers}
                messagesEndRef={messagesEndRef}
                formatTime={formatTime}
                deleteMessage={deleteMessage}
                handleRegenerate={handleRegenerate}
              />
            </div>

            <div className="shrink-0 px-3 pb-4 pt-2">
              <AgentProgressPanel events={agentRunner.events} status={agentRunner.status} />
              <div className="max-w-3xl mx-auto">
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
                      selectedAgent.id === "create-image" ? "Describe the image you want to generate…" :
                      selectedAgent.id === "deep-research" ? "What do you want to research in depth?" :
                      selectedAgent.id === "guided-learning" ? "What topic would you like to learn about?" :
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
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-background/50"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => { setShowToolConfig(!showToolConfig); setShowMcpServers(false); }}
                        className={`p-1 transition-colors rounded-md hover:bg-background/50 ${showToolConfig ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <Wrench className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => { setShowMcpServers(!showMcpServers); setShowToolConfig(false); }}
                        className={`p-1 transition-colors rounded-md hover:bg-background/50 ${showMcpServers ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <Database className="w-3.5 h-3.5" />
                      </button>

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

                      <ToolConfigPanel
                        showToolConfig={showToolConfig}
                        setShowToolConfig={setShowToolConfig}
                        toolConfigs={toolConfigs}
                        showAddTool={showAddTool}
                        setShowAddTool={setShowAddTool}
                        newToolName={newToolName}
                        setNewToolName={setNewToolName}
                        newToolSource={newToolSource}
                        setNewToolSource={setNewToolSource}
                        handleAddTool={handleAddTool}
                        removeToolConfig={removeToolConfig}
                        toggleToolConfig={toggleToolConfig}
                        openJsonEditor={openJsonEditor}
                      />

                      <McpServersPanel
                        showMcpServers={showMcpServers}
                        setShowMcpServers={setShowMcpServers}
                        mcpServers={mcpServers}
                        showAddMcp={showAddMcp}
                        setShowAddMcp={setShowAddMcp}
                        newMcpName={newMcpName}
                        setNewMcpName={setNewMcpName}
                        newMcpUrl={newMcpUrl}
                        setNewMcpUrl={setNewMcpUrl}
                        handleAddMcp={handleAddMcp}
                        removeMcp={removeMcp}
                        toggleMcpEnabled={toggleMcpEnabled}
                        openJsonEditor={openJsonEditor}
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
    </div>
  );
}
