/**
 * AI Sandbox MCP Daemon
 *
 * Exposes two tools:
 *   run_js     — executes JS in an isolated worker_thread (vm sandbox)
 *   run_python — executes Python via subprocess with restricted builtins
 *
 * Transport: HTTP JSON-RPC on port 4002 (called by builtInTools.ts)
 *
 * Unified output format for both tools:
 *   { stdout, stderr, result, logs, error }
 */

import http from "http";
import { Worker } from "worker_threads";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4002;
const JS_TIMEOUT_MS = 5000;
const PY_TIMEOUT_MS = 8000;

// ── JS execution via worker_thread ──────────────────────────────────────────
function runJs(code) {
  return new Promise((resolve) => {
    const worker = new Worker(path.join(__dirname, "js_runner.js"), {
      workerData: { code },
    });

    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ stdout: "", stderr: "", result: undefined, logs: [], error: "Execution timed out (5s)" });
    }, JS_TIMEOUT_MS);

    worker.on("message", (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });

    worker.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout: "", stderr: "", result: undefined, logs: [], error: err.message });
    });
  });
}

// ── Python execution via subprocess ─────────────────────────────────────────
function runPython(code) {
  return new Promise((resolve) => {
    const proc = spawn("python3", [path.join(__dirname, "python_runner.py")], {
      timeout: PY_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let errOut = "";

    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { errOut += d.toString(); });

    proc.on("close", (code) => {
      try {
        const parsed = JSON.parse(out.trim());
        resolve(parsed);
      } catch {
        resolve({
          stdout: out,
          stderr: errOut,
          result: undefined,
          logs: out.splitlines?.() ?? out.split("\n"),
          error: code !== 0 ? `Process exited with code ${code}` : null,
        });
      }
    });

    proc.on("error", (err) => {
      // python3 not found — try python
      if (err.code === "ENOENT") {
        const proc2 = spawn("python", [path.join(__dirname, "python_runner.py")], {
          timeout: PY_TIMEOUT_MS,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let out2 = "";
        proc2.stdout.on("data", (d) => { out2 += d.toString(); });
        proc2.on("close", () => {
          try { resolve(JSON.parse(out2.trim())); }
          catch { resolve({ stdout: "", stderr: "", result: undefined, logs: [], error: "Python not found. Install Python 3." }); }
        });
        proc2.on("error", () => {
          resolve({ stdout: "", stderr: "", result: undefined, logs: [], error: "Python not found. Install Python 3." });
        });
        proc2.stdin.write(code);
        proc2.stdin.end();
        return;
      }
      resolve({ stdout: "", stderr: "", result: undefined, logs: [], error: err.message });
    });

    proc.stdin.write(code);
    proc.stdin.end();
  });
}

// ── JSON-RPC dispatcher ──────────────────────────────────────────────────────
async function dispatch(method, params) {
  if (method !== "tools/call") {
    return { error: { code: -32601, message: `Method not found: ${method}` } };
  }

  const toolName = params?.name;
  const args = params?.arguments ?? {};

  if (toolName === "run_js") {
    const code = String(args.code ?? "");
    if (!code.trim()) return { result: { stdout: "", stderr: "", result: undefined, logs: [], error: null } };
    const output = await runJs(code);
    return { result: output };
  }

  if (toolName === "run_python") {
    const code = String(args.code ?? "");
    if (!code.trim()) return { result: { stdout: "", stderr: "", result: undefined, logs: [], error: null } };
    const output = await runPython(code);
    return { result: output };
  }

  return { error: { code: -32602, message: `Unknown tool: ${toolName}. Available: run_js, run_python` } };
}

// ── HTTP server (JSON-RPC 2.0) ───────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", async () => {
    let rpc;
    try {
      rpc = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
      return;
    }

    const { id, method, params } = rpc;
    const outcome = await dispatch(method, params);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id, ...outcome }));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sandbox] MCP daemon listening on http://127.0.0.1:${PORT}`);
  console.log(`[sandbox] Tools: run_js (worker_threads), run_python (subprocess)`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[sandbox] Port ${PORT} already in use. Is another sandbox instance running?`);
    process.exit(1);
  }
  throw err;
});
