import { Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "@aistclaw/stores/use-ui-store";
import { useIsTablet } from "@aistclaw/hooks/use-media-query";

export function Topbar() {
  const { t } = useTranslation("topbar");
  const setMobileSidebarOpen = useUiStore((s) => s.setMobileSidebarOpen);
  const isMobile = useIsTablet();

  const handleSidebarToggle = () => setMobileSidebarOpen(true);

  return (
    <header className="flex h-8 items-center justify-between border-b bg-background px-3 landscape-compact">
      <div className="flex items-center gap-2">
        {isMobile && (
          <button
            onClick={handleSidebarToggle}
            className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title={t("openMenu")}
          >
            <Layers className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2" />
    </header>
  );
}

