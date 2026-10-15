import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CONTAINER_NAME = "aistclaw-pgvector";

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryRun(cmd) {
  try {
    return run(cmd);
  } catch {
    return "";
  }
}

function parseEnvFile(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;

  const raw = readFileSync(filePath, "utf8");
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function resolveDsn() {
  if (process.env.AISTCLAW_POSTGRES_DSN) return process.env.AISTCLAW_POSTGRES_DSN;
  if (process.env.AISTCLAW_POSTGRES_DSN) return process.env.AISTCLAW_POSTGRES_DSN;
  const cwd = process.cwd();
  const env = parseEnvFile(join(cwd, ".env"));
  const envLocal = parseEnvFile(join(cwd, ".env.local"));
  return envLocal.AISTCLAW_POSTGRES_DSN
    || env.AISTCLAW_POSTGRES_DSN
    || envLocal.AISTCLAW_POSTGRES_DSN
    || env.AISTCLAW_POSTGRES_DSN
    || "";
}

function main() {
  if (process.env.PGVECTOR_AUTO_STOP === "0") {
    console.log("[pgvector] Auto-stop disabled (PGVECTOR_AUTO_STOP=0).");
    return;
  }

  const dsn = resolveDsn();
  if (!dsn.includes("localhost:5433") && !dsn.includes("127.0.0.1:5433")) {
    console.log("[pgvector] DSN is not using localhost:5433; skipping auto-stop.");
    return;
  }

  const running = tryRun(`docker inspect -f {{.State.Running}} ${CONTAINER_NAME}`) === "true";
  if (!running) {
    console.log("[pgvector] Container already stopped.");
    return;
  }

  run(`docker stop ${CONTAINER_NAME}`);
  console.log("[pgvector] Stopped aistclaw-pgvector.");
}

main();
