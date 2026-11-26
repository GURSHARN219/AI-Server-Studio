import React, { useState } from "react";
import { Terminal as TerminalIcon, X } from "lucide-react";
import { useStudioStore } from "@/stores/studioStore";

interface TerminalLine {
  id: string;
  text: string;
  kind: "cmd" | "out" | "ok";
}

export const TerminalDrawer: React.FC = () => {
  const toggleTerminal = useStudioStore((s) => s.toggleTerminal);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: "t-1", kind: "cmd", text: "$ npm run dev" },
    { id: "t-2", kind: "ok", text: "  VITE v5.4.19  ready in 142 ms" },
    { id: "t-3", kind: "out", text: "  ➜  Local:   http://localhost:5173/" },
  ]);

  const runCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd) return;
    setInput("");

    if (cmd === "clear") {
      setLines([]);
      return;
    }

    const next: TerminalLine[] = [{ id: `c-${Date.now()}`, kind: "cmd", text: `$ ${cmd}` }];
    if (cmd === "help") {
      next.push({
        id: `o-${Date.now()}`,
        kind: "out",
        text: "Available demo commands: help, git status, npm test, npm run build, clear",
      });
    } else if (cmd === "git status") {
      next.push({
        id: `o-${Date.now()}`,
        kind: "out",
        text: "modified: src/components/MetricsPanel.tsx\nmodified: src/server/router.ts",
      });
    } else if (cmd === "npm test") {
      next.push({
        id: `o-${Date.now()}`,
        kind: "ok",
        text: "✓ tests/router.test.ts (1 test) 12ms — all checks passed",
      });
    } else {
      next.push({
        id: `o-${Date.now()}`,
        kind: "out",
        text: `Executed '${cmd}' in workspace sandbox (exit 0)`,
      });
    }
    setLines((prev) => [...prev, ...next]);
  };

  return (
    <div className="flex h-40 shrink-0 flex-col border-t border-edge-subtle bg-surface-code">
      <div className="flex h-7 items-center justify-between border-b border-edge-subtle px-3 text-[11px] text-ink-secondary">
        <div className="flex items-center gap-1.5 font-medium">
          <TerminalIcon className="h-3.5 w-3.5 text-ink-muted" />
          <span>Terminal</span>
        </div>
        <button
          type="button"
          onClick={toggleTerminal}
          className="rounded p-0.5 text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
          aria-label="Close terminal"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed">
        {lines.map((line) => (
          <div
            key={line.id}
            className={`whitespace-pre-wrap ${
              line.kind === "cmd"
                ? "font-semibold text-ink-primary"
                : line.kind === "ok"
                  ? "text-state-success"
                  : "text-ink-secondary"
            }`}
          >
            {line.text}
          </div>
        ))}
      </div>
      <form onSubmit={runCommand} className="flex items-center gap-2 border-t border-edge-subtle px-3 py-1.5">
        <span className="font-mono text-xs text-accent-fg">$</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a command (try 'npm test' or 'git status')..."
          className="flex-1 bg-transparent font-mono text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none"
        />
      </form>
    </div>
  );
};
