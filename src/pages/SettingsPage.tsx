import { useState, useRef } from "react";
import {
  Settings, Key, FolderOpen, Info, X,
  Globe, User, Server, Wrench, Activity, Cpu, RefreshCw, Copy, Palette, MessageSquare, HelpCircle,
} from "lucide-react";
import { useHardwareInfo } from "@/hooks/useHardwareInfo";
import { useToast } from "@/hooks/use-toast";
import ProfileTab    from "@/components/settings/ProfileTab";
import AppearanceTab from "@/components/settings/AppearanceTab";
import ChatTab       from "@/components/settings/ChatTab";
import ProvidersTab  from "@/components/settings/ProvidersTab";
import McpServersTab from "@/components/settings/McpServersTab";
import ToolsTab      from "@/components/settings/ToolsTab";
import ApiTab        from "@/components/settings/ApiTab";
import PathsTab      from "@/components/settings/PathsTab";
import AdvancedTab   from "@/components/settings/AdvancedTab";
import RuntimeTab    from "@/components/settings/RuntimeTab";
import HardwareTab   from "@/components/settings/HardwareTab";
import AboutTab      from "@/components/settings/AboutTab";

type SettingsTab =
  | "profile" | "appearance" | "chat" | "providers" | "mcp" | "tools"
  | "api" | "paths" | "advanced" | "runtime" | "hardware" | "about";

const TABS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: "profile",    label: "Profile & Security", icon: User },
  { id: "appearance", label: "Appearance",         icon: Palette },
  { id: "chat",       label: "Chat",               icon: MessageSquare },
  { id: "providers",  label: "API Providers",      icon: Globe },
  { id: "mcp",        label: "MCP Servers",        icon: Server },
  { id: "tools",      label: "Tools",              icon: Wrench },
  { id: "api",        label: "Server API",         icon: Key },
  { id: "paths",      label: "Paths",              icon: FolderOpen },
  { id: "advanced",   label: "Advanced",           icon: Info },
  { id: "about",      label: "About",              icon: HelpCircle },
];

const SYSTEM_TABS: { id: SettingsTab; label: string; icon: React.ElementType; shortcut: string }[] = [
  { id: "runtime",  label: "Runtime",  icon: Activity, shortcut: "Ctrl + ⇧ + R" },
  { id: "hardware", label: "Hardware", icon: Cpu,      shortcut: "Ctrl + ⇧ + H" },
];

const TAB_CONTENT: Omit<Record<SettingsTab, React.ReactNode>, "hardware"> & { hardware?: never } = {
  profile:    <ProfileTab />,
  appearance: <AppearanceTab />,
  chat:       <ChatTab />,
  providers:  <ProvidersTab />,
  mcp:        <McpServersTab />,
  tools:      <ToolsTab />,
  api:        <ApiTab />,
  paths:      <PathsTab />,
  advanced:   <AdvancedTab />,
  runtime:    <RuntimeTab />,
  about:      <AboutTab />,
};

export default function SettingsPage({ onClose }: { onClose?: () => void }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const hw = useHardwareInfo();
  const { toast } = useToast();

  const copyHardwareInfo = () => {
    if (!hw.hardware) return;
    navigator.clipboard.writeText(JSON.stringify(hw.hardware, null, 2));
    toast({ title: "Hardware info copied" });
  };

  const allTabs = [...TABS, ...SYSTEM_TABS];
  const label = allTabs.find(t => t.id === activeTab)?.label ?? "";

  return (
    <div className="flex-1 flex h-full min-w-0 bg-transparent flex-row">
      {/* Sidebar */}
      <div className="w-56 bg-surface-hover/20 border-r border-border/50 shrink-0 flex flex-col py-4">
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground px-6 mb-2 font-semibold">Settings</p>
          <div className="px-3 space-y-0.5">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? "bg-surface-active text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-hover/50"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-8 mb-2" />
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground px-6 mb-2 font-semibold">System</p>
          <div className="px-3 space-y-0.5">
            {SYSTEM_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center justify-between px-3 py-2 text-[13px] rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-hover/50"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </div>
                <span className="text-[10px] opacity-70 font-mono">{tab.shortcut}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 bg-transparent">
        <div className="flex items-center justify-between px-8 py-5 shrink-0">
          <h2 className="text-xl font-semibold text-foreground">{label}</h2>
          <div className="flex items-center gap-2">
            {activeTab === "hardware" && (
              <>
                <button
                  onClick={copyHardwareInfo}
                  disabled={!hw.hardware}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover hover:bg-surface-active text-xs font-medium text-foreground border border-border/50 disabled:opacity-40 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy Info
                </button>
                <button
                  onClick={hw.refresh}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover hover:bg-surface-active text-xs font-medium text-foreground border border-border/50 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${hw.loading ? "animate-spin" : ""}`} /> Refresh
                </button>
              </>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 text-muted-foreground hover:bg-surface-active hover:text-foreground rounded-lg transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-8 pb-8">
          <div className="max-w-4xl mx-auto">
            {(Object.keys(TAB_CONTENT) as SettingsTab[]).map(id => (
              <div key={id} className={id === activeTab ? undefined : "hidden"}>
                {TAB_CONTENT[id]}
              </div>
            ))}
            <div className={activeTab === "hardware" ? undefined : "hidden"}>
              <HardwareTab hw={hw} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
