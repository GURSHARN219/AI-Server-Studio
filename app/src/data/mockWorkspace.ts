import type {
  BookmarkItem,
  Conversation,
  DownloadItem,
  FileNode,
  HistoryEntry,
  KnowledgeItem,
  StudioModel,
  StudioTool,
} from "@/types/studio";

export const MOCK_MODELS: StudioModel[] = [
  { id: "qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B", provider: "Local Metal GPU", contextWindow: "128k", speed: "74 tok/s", local: true },
  { id: "llama-3.3-70b", name: "Llama 3.3 70B Instruct", provider: "Local Cluster", contextWindow: "128k", speed: "42 tok/s", local: true },
  { id: "deepseek-r1-32b", name: "DeepSeek R1 Distill 32B", provider: "Local Metal GPU", contextWindow: "64k", speed: "68 tok/s", local: true },
  { id: "claude-3.7-sonnet", name: "Claude 3.7 Sonnet", provider: "Anthropic API", contextWindow: "200k", speed: "95 tok/s", local: false },
  { id: "gpt-4.1", name: "GPT-4.1", provider: "OpenAI API", contextWindow: "128k", speed: "110 tok/s", local: false },
];

export const MOCK_TOOLS: StudioTool[] = [
  { id: "read_file", name: "File Reader", description: "Read workspace files and line ranges", enabled: true, category: "filesystem" },
  { id: "apply_patch", name: "Patch Editor", description: "Apply targeted diffs to source files", enabled: true, category: "filesystem" },
  { id: "run_command", name: "Terminal Runner", description: "Execute build, test, and server commands", enabled: true, category: "runtime" },
  { id: "browser_inspect", name: "Browser Inspector", description: "Inspect localhost DOM and console logs", enabled: true, category: "web" },
  { id: "web_search", name: "Web Search", description: "Search docs and package registries", enabled: false, category: "web" },
];

export const MOCK_KNOWLEDGE: KnowledgeItem[] = [
  { id: "kb-gateway", title: "Gateway Router Spec v2", type: "docs", chunks: 42, enabled: true },
  { id: "kb-tokens", title: "Design Token Architecture", type: "repo", chunks: 18, enabled: true },
  { id: "kb-cef", title: "CEF Embedded Browser API", type: "api", chunks: 64, enabled: true },
];

export const MOCK_FILES: FileNode[] = [
  {
    path: "src",
    name: "src",
    type: "folder",
    children: [
      {
        path: "src/components",
        name: "components",
        type: "folder",
        children: [
          {
            path: "src/components/MetricsPanel.tsx",
            name: "MetricsPanel.tsx",
            type: "file",
            language: "tsx",
            changed: true,
            added: 22,
            removed: 9,
            previousContent: `import React, { useMemo } from 'react';

export interface MetricsSnapshot {
  requestsPerMin: number;
  p95LatencyMs: number;
}

export function MetricsPanel({ data }: { data: MetricsSnapshot }) {
  const formattedRate = useMemo(
    () => data.requestsPerMin.toLocaleString('en-US'),
    [data.requestsPerMin],
  );

  return (
    <section className="grid grid-cols-2 gap-3.5">
      <article className="rounded-lg border p-4">
        <p className="text-xs">Requests / min</p>
        <p className="mt-1 text-xl font-semibold">{formattedRate}</p>
      </article>
      <article className="rounded-lg border p-4">
        <p className="text-xs">P95 First Token</p>
        <p className="mt-1 text-xl font-semibold">{data.p95LatencyMs} ms</p>
      </article>
    </section>
  );
}`,
            content: `import React, { useMemo } from 'react';

export interface MetricsSnapshot {
  requestsPerMin: number;
  p95LatencyMs: number;
  activeWorkers: number;
  totalWorkers: number;
}

export function MetricsPanel({ data }: { data: MetricsSnapshot }) {
  const formattedRate = useMemo(
    () => data.requestsPerMin.toLocaleString('en-US'),
    [data.requestsPerMin],
  );

  return (
    <section className="grid grid-cols-3 gap-3.5" aria-label="Gateway throughput metrics">
      <article className="rounded-lg border border-edge-subtle bg-surface-card p-4">
        <p className="text-xs text-ink-muted">Requests / min</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-ink-primary">{formattedRate}</p>
        <p className="mt-1 text-xs text-state-success">+8.4% vs baseline</p>
      </article>

      <article className="rounded-lg border border-edge-subtle bg-surface-card p-4">
        <p className="text-xs text-ink-muted">P95 First Token</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-ink-primary">{data.p95LatencyMs} ms</p>
        <p className="mt-1 text-xs text-ink-secondary">Local Metal GPU</p>
      </article>

      <article className="rounded-lg border border-edge-subtle bg-surface-card p-4">
        <p className="text-xs text-ink-muted">Active Workers</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-ink-primary">
          {data.activeWorkers} / {data.totalWorkers}
        </p>
        <p className="mt-1 text-xs text-ink-secondary">Zero dropped frames</p>
      </article>
    </section>
  );
}`,
          },
        ],
      },
      {
        path: "src/server",
        name: "server",
        type: "folder",
        children: [
          {
            path: "src/server/router.ts",
            name: "router.ts",
            type: "file",
            language: "ts",
            changed: true,
            added: 19,
            removed: 5,
            previousContent: `export interface RouteConfig {
  path: string;
  model: string;
}

export const ROUTE_TABLE: RouteConfig[] = [
  { path: '/v1/chat/completions', model: 'qwen-2.5-coder-32b' },
];

export function resolveRoute(path: string) {
  return ROUTE_TABLE.find((entry) => entry.path === path) ?? null;
}`,
            content: `export interface RouteConfig {
  path: string;
  model: string;
  stream: boolean;
  timeoutMs: number;
}

export const ROUTE_TABLE: RouteConfig[] = [
  {
    path: '/v1/chat/completions',
    model: 'qwen-2.5-coder-32b',
    stream: true,
    timeoutMs: 30000,
  },
  {
    path: '/v1/embeddings',
    model: 'nomic-embed-text-v1.5',
    stream: false,
    timeoutMs: 10000,
  },
];

export function resolveRoute(path: string): RouteConfig | null {
  return ROUTE_TABLE.find((entry) => entry.path === path) ?? null;
}`,
          },
        ],
      },
      {
        path: "src/theme",
        name: "theme",
        type: "folder",
        children: [
          {
            path: "src/theme/tokens.css",
            name: "tokens.css",
            type: "file",
            language: "css",
            content: `:root, .light {
  --surface-canvas: 220 20% 96%;
  --surface-card: 0 0% 100%;
  --edge-subtle: 220 16% 90%;
  --ink-primary: 224 26% 14%;
  --accent-primary: 221 83% 56%;
}

.dark {
  --surface-canvas: 225 22% 7%;
  --surface-card: 225 19% 10%;
  --edge-subtle: 225 14% 16%;
  --ink-primary: 220 18% 92%;
  --accent-primary: 217 88% 60%;
}`,
          },
        ],
      },
      {
        path: "src/App.tsx",
        name: "App.tsx",
        type: "file",
        language: "tsx",
        content: `import React from 'react';
import { MetricsPanel } from './components/MetricsPanel';

export function App() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-lg font-semibold">AI Gateway Health</h1>
      <MetricsPanel
        data={{
          requestsPerMin: 14820,
          p95LatencyMs: 38,
          activeWorkers: 6,
          totalWorkers: 8,
        }}
      />
    </main>
  );
}

export default App;`,
      },
    ],
  },
  {
    path: "tests",
    name: "tests",
    type: "folder",
    children: [
      {
        path: "tests/router.test.ts",
        name: "router.test.ts",
        type: "file",
        language: "ts",
        content: `import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../src/server/router';

describe('resolveRoute', () => {
  it('resolves streaming chat completions with 30s timeout', () => {
    const route = resolveRoute('/v1/chat/completions');
    expect(route).toMatchObject({
      model: 'qwen-2.5-coder-32b',
      stream: true,
      timeoutMs: 30000,
    });
  });
});`,
      },
    ],
  },
  {
    path: "package.json",
    name: "package.json",
    type: "file",
    language: "json",
    content: `{
  "name": "ai-gateway-studio",
  "version": "1.4.2",
  "private": true,
  "scripts": {
    "dev": "vite --port 5173",
    "build": "vite build",
    "test": "vitest run"
  }
}`,
  },
  {
    path: "README.md",
    name: "README.md",
    type: "file",
    language: "md",
    content: `# AI Gateway Studio

Local inference gateway with real-time throughput metrics and streaming routes.

## Quick Start
- \`npm run dev\` to start the local preview at http://localhost:5173
- \`npm test\` to run router & metrics unit tests`,
  },
];

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "conv-gateway-metrics",
    title: "Gateway Metrics & Route Streaming",
    updatedAt: "Just now",
    model: "qwen-2.5-coder-32b",
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "Add an Active Workers card to MetricsPanel.tsx and enable streaming with a 30s timeout in router.ts.",
        timestamp: "1:18 PM",
      },
      {
        id: "msg-2",
        role: "assistant",
        timestamp: "1:18 PM",
        toolCalls: [
          {
            id: "tc-1",
            tool: "read_file",
            summary: "Read src/components/MetricsPanel.tsx & src/server/router.ts",
            durationMs: 14,
            status: "done",
            input: '{ "paths": ["src/components/MetricsPanel.tsx", "src/server/router.ts"] }',
            output: "Loaded 2 files (1,420 bytes) from workspace.",
          },
          {
            id: "tc-2",
            tool: "apply_patch",
            summary: "Updated MetricsPanel.tsx and router.ts",
            durationMs: 42,
            status: "done",
            input: '{ "files": ["MetricsPanel.tsx", "router.ts"], "hunks": 2 }',
            output: "Applied 2 hunks cleanly with zero TypeScript diagnostics.",
          },
        ],
        content: `I have updated both files and verified the TypeScript types.

**Changes applied**
- **Active Workers metric**: Added a third card in \`MetricsPanel.tsx\` displaying \`activeWorkers / totalWorkers\` with \`tabular-nums\` alignment and memoized request rate formatting.
- **Route streaming**: Added an explicit \`ROUTE_TABLE\` in \`router.ts\` with \`stream: true\` and a \`30000ms\` timeout for \`/v1/chat/completions\`.

\`\`\`ts
const route = resolveRoute('/v1/chat/completions');
// { path: '/v1/chat/completions', model: 'qwen-2.5-coder-32b', stream: true, timeoutMs: 30000 }
\`\`\`

You can inspect the live render at http://localhost:5173 or open [Gateway Health](http://localhost:5173/health) in the embedded browser.`,
        editedFiles: [
          { path: "src/components/MetricsPanel.tsx", filename: "MetricsPanel.tsx", added: 22, removed: 9 },
          { path: "src/server/router.ts", filename: "router.ts", added: 19, removed: 5 },
        ],
        hasPreviewAction: true,
      },
    ],
  },
  {
    id: "conv-theme-tokens",
    title: "Design Token Audit & Dark Mode",
    updatedAt: "2h ago",
    model: "claude-3.7-sonnet",
    messages: [
      {
        id: "msg-t1",
        role: "user",
        content: "Review src/theme/tokens.css to ensure light and dark surfaces share consistent contrast.",
        timestamp: "11:04 AM",
      },
      {
        id: "msg-t2",
        role: "assistant",
        timestamp: "11:04 AM",
        content: `All surface, border, and ink tokens in \`src/theme/tokens.css\` use HSL CSS custom properties with WCAG AA contrast ratios across both \`.light\` and \`.dark\`.`,
        editedFiles: [
          { path: "src/theme/tokens.css", filename: "tokens.css", added: 12, removed: 4 },
        ],
      },
    ],
  },
  {
    id: "conv-new-blank",
    title: "New Workspace Session",
    updatedAt: "Yesterday",
    model: "qwen-2.5-coder-32b",
    messages: [],
  },
];

export const MOCK_BOOKMARKS: BookmarkItem[] = [
  { id: "bm-1", title: "Localhost Preview", url: "http://localhost:5173", folder: "Workspace" },
  { id: "bm-2", title: "Gateway Health", url: "http://localhost:5173/health", folder: "Workspace" },
  { id: "bm-3", title: "Route Inspector", url: "http://localhost:5173/routes", folder: "Workspace" },
  { id: "bm-4", title: "Tailwind Docs", url: "https://tailwindcss.com/docs", folder: "Docs" },
];

export const MOCK_HISTORY: HistoryEntry[] = [
  { id: "h-1", title: "AI Gateway Studio — Localhost", url: "http://localhost:5173", visitedAt: "1:19 PM", dayGroup: "Today" },
  { id: "h-2", title: "Gateway Health Endpoint", url: "http://localhost:5173/health", visitedAt: "1:12 PM", dayGroup: "Today" },
  { id: "h-3", title: "Vite Dev Server Docs", url: "https://vite.dev/guide/", visitedAt: "Yesterday", dayGroup: "Yesterday" },
  { id: "h-4", title: "Chromium Embedded Framework", url: "https://bitbucket.org/chromiumembedded/cef", visitedAt: "Nov 22", dayGroup: "Earlier" },
];

export const MOCK_DOWNLOADS: DownloadItem[] = [
  { id: "dl-1", filename: "gateway-trace-2026-11-25.json", url: "http://localhost:5173/api/trace", size: "148 KB", progress: 100, status: "completed", timestamp: "1:15 PM" },
  { id: "dl-2", filename: "qwen-2.5-coder-32b-q4.gguf", url: "https://huggingface.co/models", size: "18.4 GB", progress: 100, status: "completed", timestamp: "Yesterday" },
];
