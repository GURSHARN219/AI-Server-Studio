import React from "react";
import { Minus, Square, X, Sun, Moon } from "lucide-react";

interface WindowTitleBarProps {
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
}

export default function WindowTitleBar({ theme, onToggleTheme }: WindowTitleBarProps) {
  return (
    <div
      className="h-8 bg-titlebar flex items-center justify-between relative border-b border-border select-none shrink-0 px-2"
    >
      {/* OS DRAG REGION: Placed securely behind the buttons to prevent click swallowing */}
      <div className="absolute inset-0 w-full h-full region-drag z-0" />

      <div className="flex items-center gap-2 z-10 pointer-events-none">
        <img src="/logo.png" alt="AistClaw" className="w-5 h-5 object-contain" />
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-xs z-10 pointer-events-none">
        <span className="font-semibold text-foreground">AI Server Studio</span>
        <span className="text-muted-foreground">- 0.1.01</span>
      </div>

      <div className="flex items-center gap-2 z-10 region-no-drag">
        {onToggleTheme ? (
          <button
            onClick={onToggleTheme}
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded region-no-drag"
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <div className="w-7" />
        )}

        <button
          onClick={() => {
            if (window.electron) void window.electron.minimize();
            else alert("No electron bridge found in minimize");
          }}
          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded region-no-drag"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => {
            if (window.electron) void window.electron.maximize();
            else alert("No electron bridge found in maximize");
          }}
          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded region-no-drag"
          title="Maximize"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => {
            if (window.electron) void window.electron.close().catch(e => alert(e.message));
            else alert("No electron bridge found in close");
          }}
          className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded region-no-drag hover:bg-destructive hover:text-destructive-foreground"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
