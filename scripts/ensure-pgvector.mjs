import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CONTAINER_NAME = "goclaw-pgvector";
const IMAGE = "pgvector/pgvector:pg18";
const PORT_MAP = "5433:5432";

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
  if (process.env.GOCLAW_POSTGRES_DSN) return process.env.GOCLAW_POSTGRES_DSN;
  const cwd = process.cwd();
  const env = parseEnvFile(join(cwd, ".env"));
  const envLocal = parseEnvFile(join(cwd, ".env.local"));
  return envLocal.GOCLAW_POSTGRES_DSN || env.GOCLAW_POSTGRES_DSN || "";
}

function ensureDocker() {
  try {
    run("docker info --format {{.ServerVersion}}");
    return true;
  } catch {
    console.warn("[pgvector] Docker daemon is not available. Start Docker Desktop and retry.");
    return false;
  }
}

function ensureContainer() {
  const exists = tryRun(`docker ps -a --filter name=^/${CONTAINER_NAME}$ --format {{.Names}}`) === CONTAINER_NAME;

  if (!exists) {
    console.log("[pgvector] Creating pgvector container...");
    run(
      `docker run -d --name ${CONTAINER_NAME} ` +
        `-e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=goclaw ` +
        `-p ${PORT_MAP} ${IMAGE}`
    );
    return;
  }

  const running = tryRun(`docker inspect -f {{.State.Running}} ${CONTAINER_NAME}`) === "true";
  if (!running) {
    console.log("[pgvector] Starting existing pgvector container...");
    run(`docker start ${CONTAINER_NAME}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitReady() {
  for (let i = 0; i < 30; i += 1) {
    const ready = tryRun(`docker exec ${CONTAINER_NAME} pg_isready -U postgres -d goclaw`);
    if (ready.includes("accepting connections")) {
      console.log("[pgvector] Ready on localhost:5433");
      return true;
    }
    await sleep(1000);
  }

  console.warn("[pgvector] Container started but readiness check timed out.");
  return false;
}

async function main() {
  const dsn = resolveDsn();
  if (!dsn) {
    console.log("[pgvector] GOCLAW_POSTGRES_DSN not set; skipping auto-start.");
    return;
  }

  if (!dsn.includes("localhost:5433") && !dsn.includes("127.0.0.1:5433")) {
    console.log("[pgvector] DSN is not using localhost:5433; skipping auto-start.");
    return;
  }

  if (!ensureDocker()) return;
  ensureContainer();
  await waitReady();
}

await main();
