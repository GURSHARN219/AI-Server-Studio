import { createBackendDocument, listBackendDocuments } from "@/lib/api";
import type { ExecutionMode } from "@/lib/api";
import { engineAuthHeaders, engineBase } from "@/lib/localEngine";
import { getAccountSetting } from "@/stores/accountState";

const toolExecUrl = () => `${engineBase()}/tools/execute`;

/** Call backend tool execution endpoint */
async function invokeEdgeFunction(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(toolExecUrl(), {
    method: "POST",
    headers: engineAuthHeaders(true),
    body: JSON.stringify({ tool, args }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Edge function error ${res.status}: ${text}`);
  }
  return res.json();
}

// Inline capability check to avoid circular import
function _canExecute(capabilities: string[], mode: ExecutionMode): boolean {
  if (mode === "online") return true;
  if (mode === "offline") return capabilities.every(c => c.startsWith("local:"));
  return false;
}

function _loadToolConfigs(): { id: string; capabilities: string[] }[] {
  try {
    return getAccountSetting("ai-server-tools-config", []);
  } catch { return []; }
}

// SSRF guard — block private/internal addresses
const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1|fd[0-9a-f]{2}:)/i;

function assertPublicUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid URL format. Must be a full URL starting with https://");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed.");
  }
  if (BLOCKED_HOSTS.test(parsed.hostname)) {
    throw new Error(`Blocked: "${parsed.hostname}" is a private/internal address.`);
  }
  return parsed;
}

export async function executeBuiltInTool(
  name: string,
  args: Record<string, unknown>,
  mode: ExecutionMode = "online"
): Promise<string> {
  const tools = _loadToolConfigs();

  // Resolve canonical name (support legacy flat names + new namespaced names)
  const canonical = LEGACY_ALIAS[name] ?? name;

  const tool = tools.find(t => t.id === canonical || t.id === name);
  if (tool && !_canExecute(tool.capabilities, mode)) {
    const caps = tool.capabilities.filter(c => !c.startsWith("local:")).join(", ");
    return `Blocked: "${name}" requires (${caps}) which are disabled in "${mode}" mode.`;
  }

  switch (canonical) {
    // ── web.search ──────────────────────────────────────────────────────────
    case "web.search": {
      const query = String(args.query || "");
      try {
        const data = await invokeEdgeFunction("web-search", { query });
        return JSON.stringify(data, null, 2);
      } catch (e) {
        return `Search error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── web.fetch ───────────────────────────────────────────────────────────
    case "web.fetch": {
      const rawUrl = String(args.url || "");
      try {
        assertPublicUrl(rawUrl);
        const data = await invokeEdgeFunction("url-fetch", { url: rawUrl });
        return JSON.stringify(data, null, 2);
      } catch (e) {
        return `Fetch error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── kb.search / kb.store / kb.list ──────────────────────────────────────
    case "kb.search":
    case "kb.store":
    case "kb.list":
    case "kb": {
      // Derive action from canonical name or explicit args.action
      const action = canonical === "kb.search" ? "search"
        : canonical === "kb.store" ? "add"
        : canonical === "kb.list" ? "list"
        : String(args.action || "search");

      try {
        if (action === "search") {
          const query = String(args.query || "");
          if (!query) return "Error: query is required for 'search'";
          const rows = await listBackendDocuments(query);
          if (!rows || rows.length === 0) {
            return `No documents found for "${query}".`;
          }
          return rows.map(d =>
            `## ${d.title}\n${(d.content || "").substring(0, 500)}${d.content?.length > 500 ? "…" : ""}`
          ).join("\n\n---\n\n");
        }

        if (action === "add") {
          const title = String(args.title || "Untitled");
          const content = String(args.content || "");
          if (!content) return "Error: content is required to add a document";
          const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
          await createBackendDocument({ title, content, tags, source: "ai-tool" });
          return `✅ Saved: "${title}"`;
        }

        if (action === "list") {
          const data = await listBackendDocuments();
          if (!data || data.length === 0) return "Knowledge base is empty.";
          return data.map(d =>
            `- **${d.title}** [${(d.tags || []).join(", ") || "no tags"}]`
          ).join("\n");
        }

        return `Unknown action: ${action}. Use: search, add, list`;
      } catch (e) {
        return `Knowledge base error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    default:
      return `Unknown tool "${name}". Available built-in tools: web.search, web.fetch, kb.search, kb.store, kb.list`;
  }
}

// ── Legacy name → canonical namespace map ────────────────────────────────────
// Keeps backwards compat with any stored tool configs or model outputs
// that still use the old flat names.
const LEGACY_ALIAS: Record<string, string> = {
  "web-search":       "web.search",
  "url-fetch":        "web.fetch",
  "knowledge-base":   "kb",        // routes to kb case which reads args.action
  "rag-cloud":        "kb",
  "rag-local":        "kb",
  // sandbox tools are now MCP-only (sandbox.run_js / sandbox.run_python)
  "js-sandbox":       "sandbox.run_js",
  "python-sandbox":   "sandbox.run_python",
};
import { engineFetch as fetch } from "@/api/client";
