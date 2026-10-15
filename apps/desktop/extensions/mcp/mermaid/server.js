import http from 'http';

const PORT = 4003;

// Use mermaid npm package via dynamic import (ESM)
async function renderMermaid(definition) {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, theme: 'dark' });
  const { svg } = await mermaid.render('mermaid-diagram', definition);
  return svg;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end('Method Not Allowed');
  }

  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body);

      if (payload.method === 'tools/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            tools: [{
              name: 'render_mermaid',
              description: 'Render a Mermaid diagram definition to SVG',
              inputSchema: {
                type: 'object',
                properties: {
                  definition: { type: 'string', description: 'Mermaid diagram source' }
                },
                required: ['definition']
              }
            }]
          }
        }));
      }

      if (payload.method === 'tools/call') {
        const { name, arguments: args } = payload.params;
        if (name === 'render_mermaid') {
          try {
            const svg = await renderMermaid(args.definition);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: payload.id,
              result: { svg }
            }));
          } catch (err) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: payload.id,
              error: { code: 500, message: err.message }
            }));
          }
        }
      }

      res.writeHead(400);
      res.end('Unknown method');
    } catch (e) {
      res.writeHead(400);
      res.end('Bad Request');
    }
  });
});

server.listen(PORT, () => {
  console.log(`[MCP] Mermaid server running on port ${PORT}`);
});
