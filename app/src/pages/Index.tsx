import { useState, useEffect, useCallback, type ReactNode } from "react";
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
import WorkflowsPage from "@/pages/WorkflowsPage";
import AuthPage from "@/pages/AuthPage";
import NotFound from "@/pages/NotFound";
import ModelConfigPanel from "@/components/ModelConfigPanel";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import DownloadManager from "@/components/DownloadManager";
import WindowTitleBar from "@/components/WindowTitleBar";
import StatusBar from "@/components/studio/StatusBar";
import AppContentModal from "@/components/AppContentModal";
import { useAuth } from "@/hooks/useAuth";
import { useLocalEngine } from "@/hooks/useLocalEngine";
import { useDownloadManager } from "@/hooks/useDownloadManager";
import { getAppPagePath, getStudioPageFromPath } from "@/lib/app-routes";
import { listBackendProviders } from "@/lib/api";
import { syncProviderModelPrefsFromBackend } from "@/lib/providerModelPrefs";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken } from "@/api/auth";
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
  has_key: boolean;
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
  const { toast } = useToast();
  useEffect(() => {
    const syncError = (event: Event) => toast({ title: "Local account save failed", description: `${(event as CustomEvent<string>).detail}. Your pending changes are retained for retry.`, variant: "destructive" });
    window.addEventListener("account:sync-error", syncError);
    return () => window.removeEventListener("account:sync-error", syncError);
  }, [toast]);
  const { user, loading: authLoading, stateError, checkSession } = useAuth();
  const { status: engineStatus, load, unload, loading: engineLoading } = useLocalEngine(5000);
  const { downloads, activeCount, startDownload, cancelDownload, removeDownload, retryDownload, clearCompleted } = useDownloadManager();
  const [showDownloads, setShowDownloads] = useState(false);
  const [tools, setTools] = useState<ToolItem[]>(INITIAL_TOOLS);
  const [providers, setProviders] = useState<ApiProvider[]>([]);
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
    if (location.pathname === "/workspace") navigate(getAppPagePath("chat"), { replace: true });
  }, [location.pathname, navigate]);

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
    if (page === "chat") {
      setChatSessionsOpen(true);
    }

    navigate(getAppPagePath(page));
  }, [navigate]);

  const fetchDbProviders = useCallback(async () => {
    const token = getAuthToken();
    try {
      const data = await listBackendProviders();
      if (token !== getAuthToken()) return;
      const dbProviders: ApiProvider[] = (data as DbProviderRow[]).map((p) => ({
        id: p.id,
        name: p.name,
        providerType: p.provider_type,
        baseUrl: p.base_url,
        apiKey: "",
        hasKey: p.has_key,
        enabled: p.enabled,
      }));
      setProviders(dbProviders);
    } catch {
      // keep local fallback providers if backend list is unavailable
    }
  }, []);

  useEffect(() => {
    setProviders([]);
    if (authLoading || !user) return;
    void fetchDbProviders();
  }, [authLoading, fetchDbProviders, user]);

  useEffect(() => {
            // Hydrate saved-model selections from backend JSON.
    if (authLoading || !user) return;
    void syncProviderModelPrefsFromBackend();
  }, [authLoading, user]);

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
        navigate(getAppPagePath("settings"));
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

  let pageContent: ReactNode;
  if (authLoading) {
    pageContent = (
      <div className="flex flex-1 min-h-0 items-center justify-center bg-background">
        <div className="text-xs text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  } else if (stateError) {
    pageContent = (
      <div className="flex flex-1 min-h-0 flex-col gap-3 items-center justify-center bg-background text-sm">
        <p>Could not load your local account: {stateError}</p>
        <button className="text-primary" onClick={() => void checkSession()}>Retry loading account</button>
      </div>
    );
  } else if (!currentPage) {
    pageContent = <div className="flex flex-1 min-h-0"><NotFound /></div>;
  } else {
    pageContent = (
      !user ? (
        <div className="flex-1 min-h-0">
          <AuthPage onAuth={checkSession} embeddedInAppShell />
        </div>
      ) : (
        <>

          <div className={`flex flex-1 min-h-0 min-w-0 overflow-hidden ${navPos === "bottom" ? "flex-col" : "flex-row"}`}>
            {navPos !== "right" && navPos !== "bottom" && (
              <IconSidebar
                currentPage={currentPage}
                onPageChange={handlePageChange}
                userRole={userRole}
                onOpenSettings={() => handlePageChange("settings")}
                onOpenDownloads={() => setShowDownloads(true)}
                downloadActiveCount={activeCount}
                onChatNav={handleChatNav}
                showResourceWidget={advanced.showResourceWidget}
              />
            )}

            <div className="relative isolate flex flex-1 min-w-0 min-h-0 overflow-hidden">
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
                    const result = await load(modelPath || modelId);
                    if (!result.ok) {
                      toast({ title: "Load failed", description: result.error ?? "The local model could not be loaded.", variant: "destructive" });
                      return;
                    }
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
                  onOpenSettings={() => handlePageChange("settings")}
                  onToggleTheme={toggleTheme}
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
              {currentPage === "workflows" && <WorkflowsPage />}
              {currentPage === "settings" && <SettingsPage />}

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

              {showDownloads && (
                <AppContentModal onBackdropClick={() => setShowDownloads(false)} contentClassName="max-w-2xl">
                  <DownloadManager
                    downloads={downloads}
                    onCancel={cancelDownload}
                    onRetry={retryDownload}
                    onRemove={removeDownload}
                    onClearCompleted={clearCompleted}
                    onClose={() => setShowDownloads(false)}
                  />
                </AppContentModal>
              )}
            </div>

            {(navPos === "right" || navPos === "bottom") && (
              <IconSidebar
                currentPage={currentPage}
                onPageChange={handlePageChange}
                userRole={userRole}
                onOpenSettings={() => handlePageChange("settings")}
                onOpenDownloads={() => setShowDownloads(true)}
                downloadActiveCount={activeCount}
                onChatNav={handleChatNav}
                showResourceWidget={advanced.showResourceWidget}
                horizontal={navPos === "bottom"}
              />
            )}
          </div>

        </>
      )
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 bg-background overflow-hidden">
      <KeyboardShortcuts onAction={handleShortcutAction} />

      <WindowTitleBar theme={theme} onToggleTheme={toggleTheme} />

      {pageContent}

      <StatusBar
        executionMode={executionMode}
        isNetworkOnline={isNetworkOnline}
        forceOffline={forceOffline}
        onToggleExecutionMode={toggleExecutionMode}
        tokenCount={tokenCount}
        engineAvailable={engineStatus.available}
        engineModel={engineStatus.model}
        selectedModelName={selectedModelName}
        selectedModelSource={selectedModelConfig.source}
        providerName={selectedModelConfig.providerName}
      />
    </div>
  );
};

export default Index;
