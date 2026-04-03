import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare,
  FolderOpen,
  Search,
  Terminal,
  Shield,
  Settings,
  Download,
  Cpu,
  Clapperboard,
  Mic2,
  Layers,
} from "lucide-react";
import type { Page, UserRole } from "@/pages/Index";
import { getEnginePort } from "@/lib/localEngine";

interface IconSidebarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  userRole: UserRole;
  onOpenSettings?: () => void;
  onOpenDownloads?: () => void;
  downloadActiveCount?: number;
  onChatNav?: () => void;
  showResourceWidget?: boolean;
  horizontal?: boolean;
}

const allNavItems = [
  { id: "chat" as Page, icon: MessageSquare, minRole: "user" as UserRole, title: "Chat", disabled: false },
  { id: "clawui" as Page, icon: Layers, minRole: "power-user" as UserRole, title: "AistClaw", disabled: false },
  { id: "voice" as Page, icon: Mic2, minRole: "power-user" as UserRole, title: "Voice Studio", disabled: false },
  { id: "media" as Page, icon: Clapperboard, minRole: "power-user" as UserRole, title: "Media Studio", disabled: false },
  { id: "models" as Page, icon: FolderOpen, minRole: "power-user" as UserRole, title: "My Model", disabled: false },
  { id: "search" as Page, icon: Search, minRole: "power-user" as UserRole, title: "Discover Models", disabled: false },
  { id: "api" as Page, icon: Shield, minRole: "power-user" as UserRole, title: "API Gateway", disabled: false },
  { id: "server" as Page, icon: Terminal, minRole: "power-user" as UserRole, title: "Server", disabled: false },
];

const roleLevel = (role: UserRole): number => {
  switch (role) {
    case "user": return 0;
    case "power-user": return 1;
    case "developer": return 2;
  }
};

interface ResourceUsage {
  cpuPercent: number;
  ramUsed: number;
  ramTotal: number;
}

function ResourceWidget() {
  const [usage, setUsage] = useState<ResourceUsage | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`http://localhost:${getEnginePort()}/v1/system/usage`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) setUsage(await res.json());
      } catch { /* engine offline */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  if (!usage) return null;

  const ramPct = usage.ramTotal > 0 ? Math.round((usage.ramUsed / usage.ramTotal) * 100) : 0;

  return (
    <div className="flex flex-col items-center gap-1 px-1 py-1.5 border-t border-sidebar-border w-full">
      <div className="flex items-center gap-1 w-full justify-center" title={`CPU: ${usage.cpuPercent.toFixed(0)}%`}>
        <Cpu className="w-2.5 h-2.5 text-muted-foreground/60 shrink-0" />
        <div className="w-5 h-1 bg-sidebar-border rounded-full overflow-hidden">
          <div className="h-full bg-muted-foreground/50 rounded-full transition-all" style={{ width: `${Math.min(usage.cpuPercent, 100)}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-1 w-full justify-center" title={`RAM: ${ramPct}%`}>
        <span className="text-[8px] text-muted-foreground/50 font-mono leading-none">M</span>
        <div className="w-5 h-1 bg-sidebar-border rounded-full overflow-hidden">
          <div className="h-full bg-muted-foreground/50 rounded-full transition-all" style={{ width: `${ramPct}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function IconSidebar({
  currentPage, onPageChange, userRole, onOpenSettings, onOpenDownloads,
  downloadActiveCount = 0, onChatNav, showResourceWidget = false, horizontal = false,
}: IconSidebarProps) {
  const navItems = allNavItems.filter(item => roleLevel(userRole) >= roleLevel(item.minRole));

  if (horizontal) {
    // Bottom bar layout
    return (
      <div className="h-9 bg-sidebar flex flex-row items-center justify-center px-1.5 border-t border-sidebar-border shrink-0 gap-0.5">
        {navItems.map((item) => {
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => { if (item.id === "chat" && onChatNav) onChatNav(); else onPageChange(item.id); }}
              className="relative w-7 h-7 flex items-center justify-center rounded-md transition-colors group"
            >
              {isActive && (
                <motion.div layoutId="icon-sidebar-active-h" className="absolute inset-0 bg-sidebar-accent rounded-md" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
              )}
              <item.icon className={`w-4 h-4 relative z-10 transition-colors ${isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground group-hover:text-sidebar-accent-foreground"}`} />
            </button>
          );
        })}
        <div className="flex-1" />
        {onOpenDownloads && (
          <button onClick={onOpenDownloads} className="relative w-7 h-7 flex items-center justify-center rounded-md transition-colors group" title="Downloads">
            <Download className="w-4 h-4 text-sidebar-foreground group-hover:text-sidebar-accent-foreground" />
            {downloadActiveCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold flex items-center justify-center z-20 leading-none">
                {downloadActiveCount > 9 ? "9+" : downloadActiveCount}
              </span>
            )}
          </button>
        )}
        {onOpenSettings && (
          <button onClick={onOpenSettings} className="w-7 h-7 flex items-center justify-center rounded-md transition-colors group" title="Settings">
            <Settings className="w-4 h-4 text-sidebar-foreground group-hover:text-sidebar-accent-foreground" />
          </button>
        )}
      </div>
    );
  }

  // Vertical sidebar (left or right)
  return (
    <div className="w-9 h-full bg-sidebar flex flex-col items-center py-1.5 border-r border-sidebar-border shrink-0">
      {navItems.map((item) => {
        const isActive = currentPage === item.id;
        return (
          <button
            key={item.id}
            type="button"
            title={item.id === "chat" ? "Chat — click again to show or hide conversations" : undefined}
            onClick={() => { if (item.id === "chat" && onChatNav) onChatNav(); else onPageChange(item.id); }}
            className="relative w-7 h-7 flex items-center justify-center mb-0.5 rounded-md transition-colors group"
          >
            {isActive && (
              <motion.div layoutId="icon-sidebar-active" className="absolute inset-0 bg-sidebar-accent rounded-md" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
            )}
            <item.icon className={`w-4 h-4 relative z-10 transition-colors ${isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground group-hover:text-sidebar-accent-foreground"}`} />
          </button>
        );
      })}

      <div className="flex-1" />

      {showResourceWidget && <ResourceWidget />}

      {onOpenDownloads && (
        <button onClick={onOpenDownloads} className="relative w-7 h-7 flex items-center justify-center mb-0.5 rounded-md transition-colors group" title="Downloads">
          <Download className="w-4 h-4 relative z-10 transition-colors text-sidebar-foreground group-hover:text-sidebar-accent-foreground" />
          {downloadActiveCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold flex items-center justify-center z-20 leading-none">
              {downloadActiveCount > 9 ? "9+" : downloadActiveCount}
            </span>
          )}
        </button>
      )}

      {onOpenSettings && (
        <button onClick={onOpenSettings} className="relative w-7 h-7 flex items-center justify-center mb-0.5 rounded-md transition-colors group" title="Settings">
          <Settings className="w-4 h-4 relative z-10 transition-colors text-sidebar-foreground group-hover:text-sidebar-accent-foreground" />
        </button>
      )}
    </div>
  );
}
