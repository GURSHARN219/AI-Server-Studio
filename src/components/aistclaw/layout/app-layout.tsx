import { Outlet, useLocation } from "react-router-dom";
import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "./sidebar";
import { SystemSettingsModal } from "./system-settings-modal";
import { ErrorBoundary } from "@aistclaw/components/shared/error-boundary";
import { useUiStore } from "@aistclaw/stores/use-ui-store";
import { useAuthStore } from "@aistclaw/stores/use-auth-store";
import { useIsTablet } from "@aistclaw/hooks/use-media-query";
import { AISTCLAW_BASE_PATH } from "@aistclaw/lib/constants";
import { cn } from "@aistclaw/lib/utils";

/**
 * Returns a stable key for pages that handle their own sub-navigation
 * (e.g. /chat/:sessionKey, /sessions/:key). Prevents ErrorBoundary from
 * remounting the entire page when only the dynamic param changes.
 */
function stableErrorBoundaryKey(pathname: string): string {
  // Strip dynamic segments: /chat/anything → /chat
  const localPath = pathname.startsWith(AISTCLAW_BASE_PATH)
    ? pathname.slice(AISTCLAW_BASE_PATH.length) || "/"
    : pathname;
  const base = localPath.replace(/^(\/[^/]+)\/.*$/, "$1");
  return base;
}

export function AppLayout() {
  const { t } = useTranslation("common");
  const location = useLocation();
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const mobileSidebarOpen = useUiStore((s) => s.mobileSidebarOpen);
  const setMobileSidebarOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const systemSettingsOpen = useUiStore((s) => s.systemSettingsOpen);
  const setSystemSettingsOpen = useUiStore((s) => s.setSystemSettingsOpen);
  const connected = useAuthStore((s) => s.connected);
  const isMobile = useIsTablet();

  return (
    <div className="flex h-full overflow-hidden">
      {isMobile ? (
        <>
          {/* Backdrop */}
          {mobileSidebarOpen && (
            <div
              className="fixed top-[var(--titlebar-h)] bottom-[var(--statusbar-h)] left-9 right-0 z-40 bg-black/50 transition-opacity"
              onClick={() => setMobileSidebarOpen(false)}
            />
          )}
          {/* Slide-out sidebar */}
          <div
            className={cn(
              "fixed top-[var(--titlebar-h)] bottom-[var(--statusbar-h)] left-9 z-50 shadow-xl transition-transform duration-200 ease-in-out",
              mobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            <Sidebar collapsed={false} onNavItemClick={() => setMobileSidebarOpen(false)} />
          </div>
        </>
      ) : (
        <Sidebar collapsed={sidebarCollapsed} />
      )}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!connected && (
          <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>{t("disconnectedGateway")}</span>
          </div>
        )}
        <main className="min-w-0 flex-1 flex flex-col overflow-y-auto">
          <ErrorBoundary key={stableErrorBoundaryKey(location.pathname)}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <SystemSettingsModal
        open={systemSettingsOpen}
        onOpenChange={setSystemSettingsOpen}
      />
    </div>
  );
}
