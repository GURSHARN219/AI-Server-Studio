// Minimal MCP RAG Server implementation
// To be extended with Qdrant + Embeddings
import http from 'http';

const PORT = 4001;

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        
        // Handle Discovery
        if (payload.method === 'tools/list') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: {
              tools: [
                {
                  name: "rag_search",
                  description: "Search local Vector DB for semantic document match",
                  inputSchema: {
                    type: "object",
                    properties: { query: { type: "string" } },
                    required: ["query"]
                  }
                },
                {
                  name: "rag_store",
                  description: "Store a document in the local Vector DB",
                  inputSchema: {
                    type: "object",
                    properties: { content: { type: "string" }, metadata: { type: "object" } },
                    required: ["content"]
                  }
                }
              ]
            }
          }));
          return;
        }

        // Handle Execution
        if (payload.method === 'tools/call') {
          const { name, arguments: args } = payload.params;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          
          if (name === 'rag_search') {
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id,
              result: "Simulated RAG Search Result: Local Vector DB not connected yet."
            }));
            return;
          }
          if (name === 'rag_store') {
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id,
              result: "Simulated RAG Store: Document saved to local DB."
            }));
            return;
          }
        }
      } catch (e) {
        res.writeHead(400);
        res.end("Bad Request");
      }
    });
  } else {
    res.writeHead(405);
    res.end("Method Not Allowed");
  }
});

server.listen(PORT, () => {
  console.log(`[Plugin] RAG server running on port ${PORT}`);
});
