import express from "express";
import cors from "cors";
import { QdrantClient } from "@qdrant/js-client-rest";
import { pipeline, env } from "@xenova/transformers";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import crypto from "crypto";

// Optional: don't pull models from remote if they are downloaded already,
// but Xenova will cache by default into node_modules or system cache.
env.allowLocalModels = false;
env.useBrowserCache = false;

const app = express();
// Increase limit for giant file uploads
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// 1. Qdrant Setup
const client = new QdrantClient({
  url: process.env.QDRANT_URL || "http://localhost:6333"
});

async function initQdrant() {
  try {
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === "documents");
    if (!exists) {
      await client.createCollection("documents", {
        vectors: { size: 384, distance: "Cosine" }
      });
      console.log("Created Qdrant collection 'documents'");
    } else {
      console.log("Qdrant collection 'documents' ready");
    }
  } catch (err) {
    console.warn("Could not connect to Qdrant. Is it running on port 6333? Error:", err.message);
  }
}
initQdrant();

// 2. Embedding Model (Local)
let embedder;
async function getEmbedder() {
  if (!embedder) {
    console.log("Loading embedding model (first run takes longer)...");
    embedder = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
    console.log("Model loaded successfully.");
  }
  return embedder;
}

async function embed(text) {
  const model = await getEmbedder();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

// 3. Document Extraction (Base64)
async function extractTextFromBase64(base64Data, filename) {
  const buffer = Buffer.from(base64Data, "base64");
  
  if (filename.toLowerCase().endsWith(".pdf")) {
    const data = await pdf(buffer);
    return data.text;
  }
  if (filename.toLowerCase().endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  
  // Default txt fallback
  return buffer.toString("utf-8");
}

// 4. Chunking
function chunkText(text, size = 500, overlap = 100) {
  const chunks = [];
  // Clean text a bit
  const cleanText = text.replace(/\s+/g, " ").trim();
  for (let i = 0; i < cleanText.length; i += size - overlap) {
    chunks.push(cleanText.slice(i, i + size));
  }
  return chunks;
}

// 5. Store Document
async function addDocument(text, source = "text", userId = "default") {
  const chunks = chunkText(text);
  const points = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const vector = await embed(chunk);

    points.push({
      id: crypto.randomUUID(),
      vector,
      payload: { 
        text: chunk,
        source,
        userId,
        chunkIndex: i
      }
    });
  }

  if (points.length > 0) {
    await client.upsert("documents", { points });
  }

  return { success: true, chunksAdded: chunks.length, source };
}

// 6. Search Context
async function search(query, userId = "default") {
  const vector = await embed(query);

  const results = await client.search("documents", {
    vector,
    limit: 5,
    filter: {
      must: [{ key: "userId", match: { value: userId } }],
    }
  });

  return results.map(r => ({
    text: r.payload.text,
    source: r.payload.source,
    score: r.score
  }));
}

// 7. Express MCP-Proxy endpoints
app.post("/", async (req, res) => {
  const { method, params, id } = req.body;

  if (method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "rag_add_document",
            description: "Add a document or plain text to the local RAG database. Supports raw text or base64 encoded files (PDF, DOCX, TXT).",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string", description: "Raw text to store (if not using file upload)" },
                fileBase64: { type: "string", description: "Base64 encoded file data" },
                fileName: { type: "string", description: "Name of the file (required if fileBase64 is provided)" }
              }
            }
          },
          {
            name: "rag_search",
            description: "Search relevant context from the local RAG database using semantic search.",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "Question or topic to search for" }
              },
              required: ["query"]
            }
          }
        ]
      }
    });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;

    try {
      if (name === "rag_add_document") {
        let textToStore = args.text || "";
        let sourceName = "raw-text";
        
        if (args.fileBase64 && args.fileName) {
          sourceName = args.fileName;
          textToStore = await extractTextFromBase64(args.fileBase64, args.fileName);
        }

        if (!textToStore) {
          throw new Error("Must provide either 'text' or 'fileBase64' with 'fileName'");
        }

        const result = await addDocument(textToStore, sourceName);
        return res.json({ jsonrpc: "2.0", id, result });
      }

      if (name === "rag_search") {
        const results = await search(args.query);
        // Map it perfectly into chunks for the LLM
        const formattedResults = results.map(r => `[Source: ${r.source}]\n${r.text}`).join("\n\n---\n\n");
        return res.json({ jsonrpc: "2.0", id, result: formattedResults || "No relevant documents found." });
      }
    } catch (err) {
      console.error(`Tool execution error for ${name}:`, err);
      return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: err.message } });
    }
  }

  res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`RAG MCP running on http://localhost:${PORT}`);
});
