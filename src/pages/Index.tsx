import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import IconSidebar from "@/components/IconSidebar";
import ChatPage from "@/pages/ChatPage";
import DiscoverPage from "@/pages/DiscoverPage";
import ModelsPage from "@/pages/ModelsPage";
import ServerPage from "@/pages/ServerPage";
import SettingsPage from "@/pages/SettingsPage";
import ApiGatewayPage from "@/pages/ApiGatewayPage";
import VoicePage from "@/pages/VoicePage";
import MediaPage from "@/pages/MediaPage";
import AuthPage from "@/pages/AuthPage";
import NotFound from "@/pages/NotFound";
import ModelConfigPanel from "@/components/ModelConfigPanel";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import DownloadManager from "@/components/DownloadManager";
import WindowTitleBar from "@/components/WindowTitleBar";
import { useAuth } from "@/hooks/useAuth";
import { useLocalEngine } from "@/hooks/useLocalEngine";
import { useDownloadManager } from "@/hooks/useDownloadManager";
import { getAppPagePath, getStudioPageFromPath } from "@/lib/app-routes";
import { listBackendProviders } from "@/lib/api";
import { syncProviderModelPrefsFromBackend } from "@/lib/providerModelPrefs";
import { useSettingsStore } from "@/stores/settingsStore";
import type { Page, UserRole, ToolItem, ApiProvider } from "@/types";
export type { Page, UserRole, ToolItem, ApiProvider } from "@/types";

const INITIAL_TOOLS: ToolItem[] = [
  { id: "js-sandbox", name: "Code Sandbox (JS)", source: "built-in", enabled: true, tagLabel: "js-sandbox", tagColor: "text-primary" },
  { id: "python-sandbox", name: "Code Sandbox (Python)", source: "built-in", enabled: true, tagLabel: "py-sandbox", tagColor: "text-yellow-500" },
  { id: "web-search", name: "Web Search", source: "built-in", enabled: true, tagLabel: "web-search", tagColor: "text-status-downloading" },
  { id: "url-fetch", name: "URL Fetch", source: "built-in", enabled: true, tagLabel: "url-fetch", tagColor: "text-status-online" },
  { id: "knowledge-base", name: "Knowledge Base", source: "built-in", enabled: true, tagLabel: "knowledge-base", tagColor: "text-muted-foreground" },
];

const CHAT_SESSIONS_OPEN_KEY = "ai-server-chat-sessions-open";
const STORAGE_FORCE_OFFLINE_KEY = "ai-server-force-offline";
const STORAGE_THEME_KEY = "ai-server-theme";

const INITIAL_PROVIDERS: ApiProvider[] = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "", enabled: false },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: "", enabled: false },
  { id: "google", name: "Google AI", baseUrl: "https://generativelanguage.googleapis.com/v1", apiKey: "", enabled: false },
  { id: "mistral", name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", apiKey: "", enabled: false },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "", enabled: false },
  { id: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", apiKey: "", enabled: false },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "", enabled: false },
];

type DbProviderRow = {
  id: string;
  name: string;
  provider_type?: string;
  base_url: string;
  api_key: string | null;
  enabled: boolean;
};

type SelectedModelConfigContext = {
  source: "local" | "api";
  providerName?: string;
  providerType?: string;
  modelType?: "chat" | "image" | "stt" | "tts" | "video";
};

const Index = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading, checkSession } = useAuth();
  const { status: engineStatus, load, unload, loading: engineLoading } = useLocalEngine(5000);
  const { downloads, activeCount, startDownload, cancelDownload, removeDownload, retryDownload, clearCompleted } = useDownloadManager();
  const [showSettings, setShowSettings] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);
  const [tools, setTools] = useState<ToolItem[]>(INITIAL_TOOLS);
  const [providers, setProviders] = useState<ApiProvider[]>(() => {
    const saved = localStorage.getItem("ai-server-providers");
    return saved ? JSON.parse(saved) : INITIAL_PROVIDERS;
  });
  const [userRole] = useState<UserRole>("developer");
  const [tokenCount, setTokenCount] = useState(0);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [selectedModelConfig, setSelectedModelConfig] = useState<SelectedModelConfigContext>({ source: "local" });
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [newChatTrigger, setNewChatTrigger] = useState(0);
  const [forceOffline, setForceOffline] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_FORCE_OFFLINE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [isNetworkOnline, setIsNetworkOnline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });
  const [chatSessionsOpen, setChatSessionsOpen] = useState(() => {
    try {
      return localStorage.getItem(CHAT_SESSIONS_OPEN_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const saved = localStorage.getItem(STORAGE_THEME_KEY);
      return saved === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const currentPage = getStudioPageFromPath(location.pathname);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
      root.classList.remove("dark");
    } else {
      root.classList.add("dark");
      root.classList.remove("light");
    }
    try {
      localStorage.setItem(STORAGE_THEME_KEY, theme);
    } catch {
      // ignore storage issues
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_SESSIONS_OPEN_KEY, String(chatSessionsOpen));
    } catch { /* ignore */ }
  }, [chatSessionsOpen]);

  useEffect(() => {
    const onOnline = () => setIsNetworkOnline(true);
    const onOffline = () => setIsNetworkOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const executionMode = forceOffline || !isNetworkOnline ? "offline" : "online";

  const toggleExecutionMode = useCallback(() => {
    setForceOffline((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_FORCE_OFFLINE_KEY, String(next));
      } catch {
        // ignore storage issues
      }
      window.dispatchEvent(new CustomEvent("execution-mode:force-offline-changed", {
        detail: { forceOffline: next },
      }));
      return next;
    });
  }, []);

  const handleChatNav = useCallback(() => {
    if (currentPage !== "chat") {
      navigate(getAppPagePath("chat"));
      setChatSessionsOpen(true);
    } else {
      setChatSessionsOpen((o) => !o);
    }
  }, [currentPage, navigate]);

  const handlePageChange = useCallback((page: Page) => {
    if (page === "settings") {
      setShowSettings(true);
      return;
    }

    if (page === "chat") {
      setChatSessionsOpen(true);
    }

    navigate(getAppPagePath(page));
  }, [navigate]);

  useEffect(() => {
    localStorage.setItem("ai-server-providers", JSON.stringify(providers));
  }, [providers]);

  const fetchDbProviders = useCallback(async () => {
    try {
      const data = await listBackendProviders();
      const dbProviders: ApiProvider[] = (data as DbProviderRow[]).map((p) => ({
        id: p.id,
        name: p.name,
        providerType: p.provider_type,
        baseUrl: p.base_url,
        apiKey: p.api_key || "",
        enabled: p.enabled,
      }));
      setProviders(dbProviders);
    } catch {
      // keep local fallback providers if backend list is unavailable
    }
  }, []);

  useEffect(() => {
    fetchDbProviders();
  }, [fetchDbProviders]);

  useEffect(() => {
    // Hydrate saved-model selections from backend JSON when running under Electron.
    void syncProviderModelPrefsFromBackend();
  }, []);

  const toggleTool = (id: string) => {
    setTools(prev => prev.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const addTool = (tool: ToolItem) => {
    setTools(prev => [...prev, tool]);
  };

  const handleModelSelect = (modelName: string) => {
    setSelectedModelName(modelName);
    setSelectedModelConfig({ source: "local" });
  };

  const handleShortcutAction = useCallback((action: string) => {
    switch (action) {
      case "new-chat":
        navigate(getAppPagePath("chat"));
        setChatSessionsOpen(true);
        setNewChatTrigger(prev => prev + 1);
        break;
      case "settings":
        setShowSettings(true);
        break;
      case "chat":
        navigate(getAppPagePath("chat"));
        setChatSessionsOpen(true);
        break;
      case "server":
        navigate(getAppPagePath("server"));
        break;
      case "models":
        navigate(getAppPagePath("models"));
        break;
      case "search":
        navigate(getAppPagePath("search"));
        break;
    }
  }, [navigate]);

  const { appearance, advanced } = useSettingsStore();
  const navPos = appearance.navBarPosition; // "left" | "right" | "bottom"

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-xs text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!currentPage) {
    return <NotFound />;
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <KeyboardShortcuts onAction={handleShortcutAction} />

      <WindowTitleBar theme={theme} onToggleTheme={toggleTheme} />

      {!user ? (
        <div className="flex-1 min-h-0">
          <AuthPage onAuth={checkSession} embeddedInAppShell />
        </div>
      ) : (
        <>

          <div className={`flex flex-1 min-h-0 ${navPos === "bottom" ? "flex-col" : "flex-row"}`}>
            {navPos !== "right" && navPos !== "bottom" && (
              <IconSidebar
                currentPage={currentPage}
                onPageChange={handlePageChange}
                userRole={userRole}
                onOpenSettings={() => setShowSettings(true)}
                onOpenDownloads={() => setShowDownloads(true)}
                downloadActiveCount={activeCount}
                onChatNav={handleChatNav}
                showResourceWidget={advanced.showResourceWidget}
              />
            )}

            <div className="flex flex-1 min-w-0">
              {currentPage === "chat" && (
                <ChatPage
                  tools={tools}
                  onToggleTool={toggleTool}
                  onModelSelect={handleModelSelect}
                  onAddTool={addTool}
                  newChatTrigger={newChatTrigger}
                  providers={providers}
                  sessionsPanelOpen={chatSessionsOpen}
                  onActiveModelNameChange={setSelectedModelName}
                  onOpenModelConfig={() => {
                    if (showModelConfig) setShowModelConfig(false);
                    else if (selectedModelName) {
                      setSelectedModelConfig({ source: "local" });
                      setShowModelConfig(true);
                    }
                  }}
                  onLoadModel={async (modelId: string, modelName: string, modelPath?: string) => {
                    await load(modelPath || modelId);
                    setSelectedModelName(modelName);
                    setSelectedModelConfig({ source: "local" });
                  }}
                  onEjectModel={async () => {
                    await unload();
                    setSelectedModelName(null);
                    setShowModelConfig(false);
                  }}
                  runningLocalModel={engineStatus.model}
                  localModelLoading={engineLoading}
                  onTokenCountChange={setTokenCount}
                />
              )}
              {currentPage === "discover" && <DiscoverPage onStartDownload={startDownload} />}
              {currentPage === "models" && (
                <ModelsPage
                  onOpenModelConfig={(name, context) => {
                    if (showModelConfig && selectedModelName === name) {
                      setShowModelConfig(false);
                    } else {
                      setSelectedModelName(name);
                      setSelectedModelConfig(context ?? { source: "local" });
                      setShowModelConfig(true);
                    }
                  }}
                />
              )}
              {currentPage === "search" && <DiscoverPage onStartDownload={startDownload} />}
              {currentPage === "server" && <ServerPage />}
              {currentPage === "api" && <ApiGatewayPage />}
              {currentPage === "voice" && <VoicePage mode={executionMode} providers={providers} />}
              {currentPage === "media" && <MediaPage providers={providers} />}

              <AnimatePresence>
                {showModelConfig && selectedModelName && (currentPage === "chat" || currentPage === "models") && (
                  <motion.div
                    key="model-config-drawer"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: "min(20rem, calc(100vw - 1.5rem))", opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="flex flex-col border-l border-border bg-background shadow-xl overflow-hidden shrink-0"
                  >
                    <ModelConfigPanel
                      modelName={selectedModelName}
                      modelPath={selectedModelConfig.source === "local" ? engineStatus.model : undefined}
                      configSource={selectedModelConfig.source}
                      providerName={selectedModelConfig.providerName}
                      providerType={selectedModelConfig.providerType}
                      modelType={selectedModelConfig.modelType}
                      onClose={() => setShowModelConfig(false)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {showSettings && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-8" onClick={() => { setShowSettings(false); fetchDbProviders(); }}>
                  <div className="w-full max-w-5xl h-[800px] max-h-[90vh] bg-background/95 border border-border/50 rounded-xl shadow-2xl overflow-hidden flex flex-col backdrop-blur-xl" onClick={e => e.stopPropagation()}>
                    <div className="flex-1 min-h-0 bg-transparent flex flex-col">
                      <SettingsPage onClose={() => { setShowSettings(false); fetchDbProviders(); }} />
                    </div>
                  </div>
                </div>
              )}

              {showDownloads && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-8" onClick={() => setShowDownloads(false)}>
                  <div className="w-full max-w-2xl bg-background border border-border/50 rounded-xl shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                    <DownloadManager
                      downloads={downloads}
                      onCancel={cancelDownload}
                      onRetry={retryDownload}
                      onRemove={removeDownload}
                      onClearCompleted={clearCompleted}
                      onClose={() => setShowDownloads(false)}
                    />
                  </div>
                </div>
              )}
            </div>

            {(navPos === "right" || navPos === "bottom") && (
              <IconSidebar
                currentPage={currentPage}
                onPageChange={handlePageChange}
                userRole={userRole}
                onOpenSettings={() => setShowSettings(true)}
                onOpenDownloads={() => setShowDownloads(true)}
                downloadActiveCount={activeCount}
                onChatNav={handleChatNav}
                showResourceWidget={advanced.showResourceWidget}
                horizontal={navPos === "bottom"}
              />
            )}
          </div>

        </>
      )}

      {/* Status bar */}
      <div className="h-6 bg-statusbar border-t border-border flex items-center px-3 text-[10px] font-mono text-muted-foreground gap-4 shrink-0 select-none">
        <span className="text-foreground/60">AI Server Studio 0.1.01</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleExecutionMode}
            className="relative flex items-center h-[18px] w-24 rounded bg-background border border-border/60 p-[1.5px] hover:border-border transition-colors cursor-pointer select-none"
            title={executionMode === "offline" ? "Switch to online mode" : "Switch to offline mode"}
          >
            {/* Sliding background pill */}
            <div
              className={`absolute top-[1.5px] bottom-[1.5px] w-[calc(50%-1.5px)] rounded-[2px] transition-all duration-300 ease-out ${executionMode === "online" ? "translate-x-[calc(100%+0px)] bg-status-online/15" : "translate-x-0 bg-muted/60"
                }`}
            />
            {/* Text labels */}
            <span className={`relative z-10 flex-1 text-center text-[9px] uppercase tracking-wider font-bold transition-colors duration-300 ${executionMode === "offline" ? "text-foreground" : "text-muted-foreground/50"
              }`}>
              Offline
            </span>
            <span className={`relative z-10 flex-1 text-center text-[9px] uppercase tracking-wider font-bold transition-colors duration-300 ${executionMode === "online" ? "text-status-online drop-shadow-[0_0_2px_currentColor]" : "text-muted-foreground/50"
              }`}>
              Online
            </span>
          </button>
          {!isNetworkOnline && !forceOffline && <span className="text-[8px] text-muted-foreground italic tracking-wider">auto</span>}
        </div>
        <span>Tokens <span className="text-foreground/60">{tokenCount}</span></span>
        <span>Engine <span className={engineStatus.available ? "text-status-online" : "text-destructive"}>{engineStatus.available ? "Online" : "Offline"}</span></span>
        {engineStatus.available && engineStatus.model && (
          <span className="text-foreground/60 truncate max-w-[160px]">{engineStatus.model}</span>
        )}
      </div>
    </div>
  );
};

export default Index;
