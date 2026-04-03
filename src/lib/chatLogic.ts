import { ApiMessage, executeBuiltInTool, McpServerConfig, executeMcpToolCall } from "@/lib/api";

const HYBRID_RAG_TEMPLATE = `You are an AI assistant with structured memory.

Each memory item includes a relevance score (higher = more relevant).

Guidelines:
* Prefer higher-score items.
* Prefer Chat Memory over Global Memory when scores are similar.
* Ignore low-relevance items (score < 0.5).
* Do NOT hallucinate or invent information from memory. If no relevant memory is found, answer normally using your own knowledge.
* If memory conflicts: trust Chat Memory

---

Chat Memory:
{chat_context}

---

Global Knowledge:
{global_context}

---

User Question:
{user_input}

---

Use only the most relevant information to answer.`;

export async function buildHybridMemoryPrompt(
  userInput: string,
  recentMessages: ApiMessage[],
  executionMode: "offline" | "online",
  mcpToolDefs: { serverId: string; serverName: string; tools: { name: string }[] }[],
  mcpServers: McpServerConfig[]
): Promise<string> {
  try {
    // 1. STM - Short Term Memory (last 6 messages)
    const chatContext = recentMessages
      .slice(-6)
      .map((m) => `[CHAT][score: 1.0]\n${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    // 2. LTM - Global Knowledge Base
    let globalContext = "";
    
    try {
      // Priority 1: Check if user has connected the robust local Qdrant RAG MCP server
      // The local server has actual semantic scoring.
      const mcpSource = mcpToolDefs.find(s => s.tools.some(t => t.name === "rag_search"));
      
      if (mcpSource) {
        const mcpServer = mcpServers.find(s => s.id === mcpSource.serverId);
        if (mcpServer) {
           const result = await executeMcpToolCall(mcpServer, "rag_search", { query: userInput });
           if (!result.startsWith("Error:") && !result.includes("No relevant documents")) {
             globalContext = result.slice(0, 2500);
           }
        }
      }

      // Priority 2: Fallback to the cloud RAG (Supabase Edge) if local is missing or offline
      if (!globalContext && executionMode !== "offline") {
         const ragResult = await executeBuiltInTool("rag-cloud", { action: "search", query: userInput }, executionMode);
         if (!ragResult.startsWith("Error:") && !ragResult.includes("No documents found")) {
           globalContext = ragResult.slice(0, 2500);
         }
      }
    } catch {
       // Skip global memory if RAG fails (e.g., offline mode blocking cloud)
    }

    // Only apply the hybrid prompt if we actually found external global context.
    // If globalContext is empty, return raw input to avoid wrapping every message in noise.
    if (!globalContext.trim()) {
      return userInput;
    }

    const finalPrompt = HYBRID_RAG_TEMPLATE
      .replace("{chat_context}", chatContext || "(No chat history)")
      .replace("{global_context}", globalContext || "(No global knowledge found)")
      .replace("{user_input}", userInput);

    return finalPrompt;
  } catch (err) {
    console.warn("Hybrid Memory Build Error:", err);
    return userInput;
  }
}
