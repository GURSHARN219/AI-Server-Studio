import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "@aistclaw/i18n";
import { AppProviders } from "@aistclaw/components/providers/app-providers";
import { AppRoutes } from "../aistclaw-routes";
import { setAistclawPort } from "@aistclaw/lib/runtime";
import { useUiStore } from "@aistclaw/stores/use-ui-store";
import { useSettingsStore } from "@/stores/settingsStore";
import { useLocalEngine } from "@/hooks/useLocalEngine";
import { useDownloadManager } from "@/hooks/useDownloadManager";
import WindowTitleBar from "@/components/WindowTitleBar";
import IconSidebar from "@/components/IconSidebar";
import SettingsPage from "@/pages/SettingsPage";
import DownloadManager from "@/components/DownloadManager";
import type { Page, UserRole } from "@/types";
import { getAppPagePath } from "@/lib/app-routes";

const STORAGE_FORCE_OFFLINE_KEY = "ai-server-force-offline";

export default function ClawUiPage() {
  const navigate = useNavigate();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const { status: engineStatus } = useLocalEngine(5000);
  const { downloads, activeCount, cancelDownload, removeDownload, retryDownload, clearCompleted } = useDownloadManager();
  const { advanced } = useSettingsStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);
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

  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark");
  };

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
      window.dispatchEvent(
        new CustomEvent("execution-mode:force-offline-changed", {
          detail: { forceOffline: next },
        }),
      );
      return next;
    });
  }, []);

  useEffect(() => {
    window.electron?.onAistclawPort?.((port: number) => {
      setAistclawPort(port);
    });
  }, []);

  const handlePageChange = (page: Page) => {
    if (page === "settings") return;
    navigate(getAppPagePath(page));
  };

  const userRole: UserRole = "developer";

  return (
    <AppProviders>
      <div className="aistclaw-host flex h-screen flex-col min-w-0 min-h-0 overflow-hidden bg-background">
        <WindowTitleBar theme={isDark ? "dark" : "light"} onToggleTheme={toggleTheme} />
      <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden items-stretch">
        <IconSidebar
          currentPage="clawui"
          onPageChange={handlePageChange}
          userRole={userRole}
          onOpenSettings={() => setShowSettings(true)}
          onOpenDownloads={() => setShowDownloads(true)}
          downloadActiveCount={activeCount}
          showResourceWidget={advanced.showResourceWidget}
          onActivePageClick={(page) => {
            if (page === "clawui") {
              useUiStore.getState().setMobileSidebarOpen(true);
            }
          }}
        />
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          <AppRoutes />
        </div>

        {showSettings && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-8"
            onClick={() => setShowSettings(false)}
          >
            <div
              className="w-full max-w-5xl h-[800px] max-h-[90vh] bg-background/95 border border-border/50 rounded-xl shadow-2xl overflow-hidden flex flex-col backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex-1 min-h-0 bg-transparent flex flex-col">
                <SettingsPage onClose={() => setShowSettings(false)} />
              </div>
            </div>
          </div>
        )}

        {showDownloads && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-8"
            onClick={() => setShowDownloads(false)}
          >
            <div
              className="w-full max-w-2xl bg-background border border-border/50 rounded-xl shadow-2xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
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

      <div className="h-[var(--statusbar-h)] bg-statusbar border-t border-border flex items-center px-3 text-[10px] font-mono text-muted-foreground gap-4 shrink-0 select-none">
        <span className="text-foreground/60">AI Server Studio 0.1.01</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleExecutionMode}
            className="relative flex items-center h-[18px] w-24 rounded bg-background border border-border/60 p-[1.5px] hover:border-border transition-colors cursor-pointer select-none"
            title={executionMode === "offline" ? "Switch to online mode" : "Switch to offline mode"}
          >
            <div
              className={`absolute top-[1.5px] bottom-[1.5px] w-[calc(50%-1.5px)] rounded-[2px] transition-all duration-300 ease-out ${
                executionMode === "online" ? "translate-x-[calc(100%+0px)] bg-status-online/15" : "translate-x-0 bg-muted/60"
              }`}
            />
            <span
              className={`relative z-10 flex-1 text-center text-[9px] uppercase tracking-wider font-bold transition-colors duration-300 ${
                executionMode === "offline" ? "text-foreground" : "text-muted-foreground/50"
              }`}
            >
              Offline
            </span>
            <span
              className={`relative z-10 flex-1 text-center text-[9px] uppercase tracking-wider font-bold transition-colors duration-300 ${
                executionMode === "online" ? "text-status-online drop-shadow-[0_0_2px_currentColor]" : "text-muted-foreground/50"
              }`}
            >
              Online
            </span>
          </button>
          {!isNetworkOnline && !forceOffline && (
            <span className="text-[8px] text-muted-foreground italic tracking-wider">auto</span>
          )}
        </div>
        <span>
          Engine{" "}
          <span className={engineStatus.available ? "text-status-online" : "text-destructive"}>
            {engineStatus.available ? "Online" : "Offline"}
          </span>
        </span>
        {engineStatus.available && engineStatus.model && (
          <span className="text-foreground/60 truncate max-w-[160px]">{engineStatus.model}</span>
        )}
      </div>
      </div>
    </AppProviders>
  );
}
