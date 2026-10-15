import fs from "fs";
import path from "path";
import net from "net";
import { spawn, ChildProcess } from "child_process";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

const PREFERRED_PORT = 4000;
const MCP_DIR = path.join(__dirname, "mcp");

function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(start, () => {
      const { port } = (server.address() as net.AddressInfo);
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      if (start >= 4100) return reject(new Error("No free port found in range 4000-4100"));
      resolve(findFreePort(start + 1));
    });
  });
}

interface Plugin {
  id: string; // generated uid
  name: string;
  type: string;
  url: string;
  capabilities: string[];
  tools: string[];
  process?: ChildProcess;
}

const runningPlugins: Plugin[] = [];

export async function loadMcpPlugins() {
  if (!fs.existsSync(MCP_DIR)) {
    console.warn(`[Daemon] MCP Directory not found at ${MCP_DIR}`);
    return;
  }

  const dirs = fs.readdirSync(MCP_DIR);

  for (const dir of dirs) {
    const pluginDir = path.join(MCP_DIR, dir);
    const manifestPath = path.join(pluginDir, "manifest.json");

    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      // Auto-start server
      console.log(`[Daemon] Starting plugin extending capability: ${manifest.name}`);

      const proc = spawn("node", [manifest.entry], {
        cwd: pluginDir,
        stdio: "inherit"
      });

      // Handle crashes gracefully
      proc.on('error', (err) => {
        console.error(`[Daemon] Failed to start plugin ${manifest.name}:`, err);
      });

      runningPlugins.push({
        id: `local-${manifest.name}-${Date.now()}`,
        name: manifest.name,
        type: manifest.type || "local",
        url: `http://localhost:${manifest.port}`,
        capabilities: manifest.capabilities || [],
        tools: manifest.tools || [],
        process: proc
      });
    } catch (err) {
      console.error(`[Daemon] Error loading manifest for ${dir}:`, err);
    }
  }
}

// Ensure child processes are killed when the daemon stops
process.on("SIGINT", () => {
  console.log("\n[Daemon] Shutting down, killing child plugins...");
  runningPlugins.forEach(p => {
    if (p.process) {
      p.process.kill();
    }
  });
  process.exit(0);
});

// Expose discovery endpoint
app.get("/plugins", (req, res) => {
  // Strip out the non-serializable ChildProcess object
  const safePlugins = runningPlugins.map(({ process, ...rest }) => rest);
  res.json(safePlugins);
});

async function start() {
  await loadMcpPlugins();

  const port = await findFreePort(PREFERRED_PORT);
  if (port !== PREFERRED_PORT) {
    console.warn(`[Daemon] Port ${PREFERRED_PORT} in use — using port ${port} instead.`);
  }

  app.listen(port, () => {
    console.log(`\n========================================`);
    console.log(`🚀 AI Studio Local Daemon running on port ${port}`);
    console.log(`📦 Loaded ${runningPlugins.length} MCP plugins:`);
    runningPlugins.forEach(p => {
      console.log(`   - ${p.name} (Port ${p.url.split(':').pop()})`);
    });
    console.log(`========================================\n`);
    if (process.send) process.send({ type: "daemon:port", port });
  });
}

start();
