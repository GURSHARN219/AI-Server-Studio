import http from 'http';
import vm from 'vm';

const PORT = 4002;
const TIMEOUT_MS = 5000;

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body);

      if (payload.method === 'tools/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          result: {
            tools: [
              {
                name: "run_js",
                description: "Execute JavaScript in an isolated Node.js vm context with a 5s timeout",
                inputSchema: {
                  type: "object",
                  properties: { code: { type: "string" } },
                  required: ["code"]
                }
              }
            ]
          }
        }));
        return;
      }

      if (payload.method === 'tools/call') {
        const { name, arguments: args } = payload.params;

        if (name === 'run_js') {
          const logs = [];
          const sandbox = {
            console: {
              log: (...a) => logs.push(a.map(String).join(' ')),
              warn: (...a) => logs.push('[warn] ' + a.map(String).join(' ')),
              error: (...a) => logs.push('[error] ' + a.map(String).join(' ')),
            },
            Math, JSON, Date, parseInt, parseFloat,
            isNaN, isFinite, encodeURIComponent, decodeURIComponent,
            __result: undefined,
          };

          try {
            // Wrap in async IIFE so top-level await works
            const wrapped = `(async () => { ${args.code} })().then(r => { __result = r; })`;
            const script = new vm.Script(wrapped, { filename: 'sandbox.js' });
            const ctx = vm.createContext(sandbox);
            await script.runInContext(ctx, { timeout: TIMEOUT_MS });

            const output = logs.join('\n');
            const ret = sandbox.__result !== undefined ? JSON.stringify(sandbox.__result, null, 2) : '';
            let result = '';
            if (output && ret) result = `Output:\n${output}\n\nReturn value:\n${ret}`;
            else if (output) result = output;
            else if (ret) result = ret;
            else result = 'Code executed successfully (no output)';

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
          } catch (e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id,
              error: { code: -32000, message: e.message }
            }));
          }
          return;
        }
      }

      res.writeHead(404);
      res.end("Not Found");
    } catch (e) {
      res.writeHead(400);
      res.end("Bad Request");
    }
  });
});

server.listen(PORT, () => {
  console.log(`[Plugin] Sandbox server running on port ${PORT}`);
});
