import { app, BrowserWindow, shell, ipcMain } from "electron";
import { spawn, spawnSync, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import net from "net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseDotEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function loadElectronEnvFromFiles() {
  const repoRoot = path.resolve(__dirname, "..");
  const envPaths = [
    path.join(repoRoot, ".env"),
    path.join(repoRoot, ".env.local"),
  ];

  const fileEnv: Record<string, string> = {};

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) continue;
    try {
      const content = fs.readFileSync(envPath, "utf8");
      Object.assign(fileEnv, parseDotEnv(content));
    } catch (err) {
      console.warn(`[Electron] Failed to read ${envPath}:`, err);
    }
  }

  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadElectronEnvFromFiles();

const isDev = !app.isPackaged;
// In development, default to dual-process mode unless explicitly enabled.
// This avoids coupling desktop startup to GoClaw/PostgreSQL availability.
const singleEngineMode = process.env.AIST_SINGLE_ENGINE
  ? process.env.AIST_SINGLE_ENGINE !== "0"
  : !isDev;
const allowStandaloneGoClawFallback = process.env.AIST_ALLOW_STANDALONE_GOCLAW_FALLBACK === "1";

let engineProcess: ChildProcess | null = null;
let goclawProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let engineRestartDelay = 1000;
let goclawRestartDelay = 1000;
let engineStopping = false;
let goclawStopping = false;
let goclawStartInProgress = false;
let goclawRestartTimer: NodeJS.Timeout | null = null;
let lastEnginePort: number | null = null; // cache so we can re-send after window load
let lastGoClawPort: number | null = null;
let goclawPortReportedByEngine = false;
let singleEngineFallbackTimer: NodeJS.Timeout | null = null;
let goclawConfigErrorLogged = false;
let goclawDbErrorLogged = false;
let devEngineSourceLaunchFailed = false;
let engineEmbeddedFlagSupported: boolean | null = null;
let windowControlHandlersRegistered = false;
// Desktop always uses the embedded runtime; CLI `aist --server` owns llama-server mode.
const preferEmbeddedEngine = true;

const GOCLAW_DEFAULT_PORT = 18790;

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, "127.0.0.1");
  });
}

function hasGoClawRequiredEnv() {
  return Boolean(process.env.GOCLAW_POSTGRES_DSN && process.env.GOCLAW_POSTGRES_DSN.trim().length > 0);
}

function supportsEmbeddedFlag(enginePath: string): boolean {
  if (engineEmbeddedFlagSupported !== null) {
    return engineEmbeddedFlagSupported;
  }

  try {
    const result = spawnSync(enginePath, ["--help"], { encoding: "utf8" });
    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    engineEmbeddedFlagSupported = combined.includes("-embedded");
  } catch {
    engineEmbeddedFlagSupported = false;
  }

  return engineEmbeddedFlagSupported;
}

function startEngine() {
  const engineBinary = path.join(process.resourcesPath, "engine.exe");
  const devEngineCwd = path.join(__dirname, "../src/backend");
  const devBackendBin = path.join(__dirname, "../src/backend/bin");
  const runEngineFromSource = isDev && process.env.AIST_DEV_ENGINE_FROM_SOURCE !== "0" && !devEngineSourceLaunchFailed;

  if (runEngineFromSource) {
    console.log(`[Electron] Starting Go engine from source: ${devEngineCwd}`);
  } else {
    const target = isDev ? path.join(__dirname, "../src/backend/engine.exe") : engineBinary;
    console.log(`[Electron] Starting Go engine binary: ${target}`);
  }
  console.log(`[Electron] Local inference mode: ${preferEmbeddedEngine ? "embedded-cgo" : "llama-server-subprocess"}`);

  const runtimeBinPath = isDev ? devBackendBin : process.resourcesPath;
  const currentPath = process.env.PATH || "";
  const mergedPath = `${runtimeBinPath}${path.delimiter}${currentPath}`;

  const repoRoot = path.resolve(__dirname, "..");
  const engineDataDir = (process.env.AI_SERVER_DATA_DIR && process.env.AI_SERVER_DATA_DIR.trim().length > 0)
    ? process.env.AI_SERVER_DATA_DIR
    : (isDev ? path.join(repoRoot, "data") : path.join(app.getPath("userData"), "data"));

  const env = {
    ...process.env,
    AIST_SINGLE_ENGINE: singleEngineMode ? "1" : "0",
    AIST_IMPORT_ENGINE_CONFIG: "1",
    AIST_ENGINE_DATA_DIR: engineDataDir,
    PATH: mergedPath,
  };
  // In dev, prefer `go run .` so the engine supervisor behavior stays in sync
  // with source changes (avoids stale engine.exe fallback behavior).
  const binaryTarget = isDev ? path.join(__dirname, "../src/backend/engine.exe") : engineBinary;
  const launchCommand = runEngineFromSource ? "go" : binaryTarget;
  const embeddedArg = `--embedded=${preferEmbeddedEngine ? "true" : "false"}`;
  const launchArgs = runEngineFromSource
    ? ["run", ".", embeddedArg]
    : (supportsEmbeddedFlag(binaryTarget) ? [embeddedArg] : []);
  const launchCwd = isDev ? devEngineCwd : process.resourcesPath;

  if (!runEngineFromSource && launchArgs.length === 0) {
    console.warn("[Electron] Engine binary does not support --embedded; running legacy binary arguments.");
  }

  engineProcess = spawn(launchCommand, launchArgs, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    cwd: launchCwd,
  });

  // Go backend outputs engine:port as JSON on stdout
  let stdoutBuffer = "";
  engineProcess.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    stdoutBuffer += text;
    process.stdout.write(text); // forward to Electron console

    // Parse JSON lines looking for engine:port message
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{")) {
        try {
          const msg = JSON.parse(trimmed);
          if (msg?.type === "engine:port") {
            lastEnginePort = msg.port;
            engineRestartDelay = 1000;
            mainWindow?.webContents.send("engine:port", msg.port);
            console.log(`[Electron] Go engine running on port ${msg.port}`);
          } else if (msg?.type === "goclaw:port") {
            lastGoClawPort = msg.port;
            goclawPortReportedByEngine = true;
            if (singleEngineFallbackTimer) {
              clearTimeout(singleEngineFallbackTimer);
              singleEngineFallbackTimer = null;
            }
            mainWindow?.webContents.send("goclaw:port", msg.port);
            console.log(`[Electron] GoClaw available on port ${msg.port} (via engine supervisor)`);
          }
        } catch { /* not JSON, skip */ }
      }
    }
  });

  engineProcess.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    if (runEngineFromSource && (text.includes("runtime/cgo") || text.includes("cc1.exe"))) {
      if (!devEngineSourceLaunchFailed) {
        devEngineSourceLaunchFailed = true;
        console.warn("[Electron] Go source launch failed (CGO/toolchain). Falling back to engine.exe for subsequent restarts.");
      }
    }
    process.stderr.write(data); // forward engine logs
  });

  engineProcess.on("error", (err) => console.error("[Electron] Engine error:", err));

  // Watchdog: restart engine on unexpected exit
  engineProcess.on("exit", (code, signal) => {
    console.log(`[Electron] Engine exited (code=${code}, signal=${signal})`);
    goclawPortReportedByEngine = false;
    if (singleEngineFallbackTimer) {
      clearTimeout(singleEngineFallbackTimer);
      singleEngineFallbackTimer = null;
    }
    if (engineStopping) return;
    console.log(`[Electron] Restarting engine in ${engineRestartDelay}ms...`);
    setTimeout(() => {
      engineRestartDelay = Math.min(engineRestartDelay * 2, 30_000);
      startEngine();
    }, engineRestartDelay);
  });
}

async function startGoClaw() {
  if (goclawStartInProgress) {
    return;
  }

  if (goclawProcess && goclawProcess.exitCode === null) {
    return;
  }

  goclawStartInProgress = true;

  if (await isPortInUse(GOCLAW_DEFAULT_PORT)) {
    // Another process (often the engine supervisor) already owns the port.
    lastGoClawPort = GOCLAW_DEFAULT_PORT;
    mainWindow?.webContents.send("goclaw:port", GOCLAW_DEFAULT_PORT);
    console.log(`[Electron] GoClaw port ${GOCLAW_DEFAULT_PORT} already in use; reusing existing instance.`);
    goclawStartInProgress = false;
    return;
  }

  if (!hasGoClawRequiredEnv()) {
    if (!goclawConfigErrorLogged) {
      console.error("[Electron] GOCLAW_POSTGRES_DSN is missing. Skipping GoClaw startup until it is configured.");
      console.error("[Electron] Set GOCLAW_POSTGRES_DSN in your shell or .env.local, then restart npm run dev:electron.");
      goclawConfigErrorLogged = true;
    }
    goclawStartInProgress = false;
    return;
  }

  const goclawBinary = isDev
    ? path.join(__dirname, "../src/backend/goclaw.exe")
    : path.join(process.resourcesPath, "goclaw.exe");

  const cwd = isDev
    ? path.join(__dirname, "../src/backend/goclaw")
    : process.resourcesPath;

  const repoRoot = path.resolve(__dirname, "..");
  const engineDataDir = (process.env.AI_SERVER_DATA_DIR && process.env.AI_SERVER_DATA_DIR.trim().length > 0)
    ? process.env.AI_SERVER_DATA_DIR
    : (isDev ? path.join(repoRoot, "data") : path.join(app.getPath("userData"), "data"));

  const env = {
    ...process.env,
    GOCLAW_PORT: String(GOCLAW_DEFAULT_PORT),
    // Enable GoClaw to import the Studio engine's providers/model defaults on startup.
    // This prevents "provider not found" errors when embedded.
    AIST_IMPORT_ENGINE_CONFIG: "1",
    AIST_ENGINE_DATA_DIR: engineDataDir,
  };

  const launch = () => {
    if (isDev) {
      return spawn("go", ["run", "."], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        cwd,
      });
    }
    return spawn(goclawBinary, [], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    });
  };

  console.log(`[Electron] Starting GoClaw backend on ${GOCLAW_DEFAULT_PORT}`);

  let goclawDbConnectivityFailed = false;

  const trackGoClawOutput = (text: string) => {
    // If DB connectivity fails during boot, restarting the process repeatedly is noisy
    // and does not recover until PostgreSQL becomes available.
    if (
      text.includes("schema compatibility check failed") ||
      text.includes("dial tcp") ||
      text.includes("connectex") ||
      text.includes("failed to connect to `user=")
    ) {
      goclawDbConnectivityFailed = true;
    }
  };

  try {
    goclawProcess = launch();
  } catch (err) {
    console.error("[Electron] Failed to start GoClaw process:", err);
    goclawStartInProgress = false;
    return;
  }

  const proc = goclawProcess;

  proc.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    trackGoClawOutput(text);
    process.stdout.write(`[goclaw] ${text}`);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    trackGoClawOutput(text);
    process.stderr.write(`[goclaw] ${text}`);
  });

  proc.on("spawn", () => {
    goclawStartInProgress = false;
    lastGoClawPort = GOCLAW_DEFAULT_PORT;
    goclawRestartDelay = 1000;
    mainWindow?.webContents.send("goclaw:port", GOCLAW_DEFAULT_PORT);
  });

  proc.on("error", (err) => {
    goclawStartInProgress = false;
    console.error("[Electron] GoClaw error:", err);
  });

  proc.on("exit", (code, signal) => {
    goclawStartInProgress = false;
    if (goclawProcess !== proc) {
      return;
    }
    goclawProcess = null;
    console.log(`[Electron] GoClaw exited (code=${code}, signal=${signal})`);
    if (goclawStopping) return;
    if (goclawDbConnectivityFailed) {
      if (!goclawDbErrorLogged) {
        console.error("[Electron] GoClaw could not connect to PostgreSQL. Restart loop paused.");
        console.error("[Electron] Start PostgreSQL and ensure GOCLAW_POSTGRES_DSN is correct, then restart npm run dev:electron.");
        goclawDbErrorLogged = true;
      }
      return;
    }
    console.log(`[Electron] Restarting GoClaw in ${goclawRestartDelay}ms...`);
    if (goclawRestartTimer) {
      clearTimeout(goclawRestartTimer);
    }
    goclawRestartTimer = setTimeout(() => {
      goclawRestartTimer = null;
      goclawRestartDelay = Math.min(goclawRestartDelay * 2, 30_000);
      void startGoClaw();
    }, goclawRestartDelay);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  win.webContents.on("did-finish-load", () => {
    if (lastEnginePort !== null) {
      win.webContents.send("engine:port", lastEnginePort);
    }
    if (lastGoClawPort !== null) {
      win.webContents.send("goclaw:port", lastGoClawPort);
    }
  });

  if (isDev) {
    win.loadURL("http://localhost:8080");
    const shouldOpenDevtools = process.env.AIST_OPEN_DEVTOOLS !== "0";
    const modeRaw = (process.env.AIST_DEVTOOLS_MODE || "right").toLowerCase();
    const devtoolsMode = (
      modeRaw === "right" ||
      modeRaw === "left" ||
      modeRaw === "bottom" ||
      modeRaw === "undocked" ||
      modeRaw === "detach"
    ) ? modeRaw : "right";

    if (shouldOpenDevtools) {
      // Open after initial load so it consistently docks in the requested side panel.
      win.webContents.once("did-finish-load", () => {
        win.webContents.openDevTools({ mode: devtoolsMode });
      });
    }
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Open external links in browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  if (!windowControlHandlersRegistered) {
    const withSenderWindow = (sender: Electron.WebContents) => {
      return BrowserWindow.fromWebContents(sender) ?? BrowserWindow.getFocusedWindow();
    };

    ipcMain.handle("window:minimize", (event) => {
        console.log("[Electron] MINIMIZE TRIGGERED");
        const win = withSenderWindow(event.sender);
        if (win && !win.isDestroyed()) {
          win.minimize();
        } else {
          console.log("[Electron] window:minimize - NO WINDOW FOUND");
        }
      });

      ipcMain.handle("window:maximize", (event) => {
        console.log("[Electron] MAXIMIZE TRIGGERED");
        const win = withSenderWindow(event.sender);
        if (!win || win.isDestroyed()) {
          console.log("[Electron] window:maximize - NO WINDOW FOUND");
          return;
        }
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      });

      ipcMain.handle("window:close", (event) => {
        console.log("[Electron] CLOSE TRIGGERED");
        const win = withSenderWindow(event.sender);
        if (win && !win.isDestroyed()) {
          win.close();
        } else {
          console.log("[Electron] window:close - NO WINDOW FOUND");
        }
      });
      
      windowControlHandlersRegistered = true;
    }

  console.log(`[Electron] Backend mode: ${singleEngineMode ? "single-engine" : "dual-process"}`);
  startEngine();

  if (!singleEngineMode) {
    // In dual-process mode, give the engine a brief moment to report whether it
    // has already started GoClaw before launching a standalone GoClaw process.
    setTimeout(() => {
      if (!goclawPortReportedByEngine && !goclawStopping) {
        void startGoClaw();
      }
    }, 1500);
  } else {
    if (!allowStandaloneGoClawFallback) {
      console.log("[Electron] Standalone GoClaw fallback is disabled in single-engine mode.");
    }
    // If single-engine mode fails to report GoClaw readiness, fallback to direct GoClaw process.
    singleEngineFallbackTimer = setTimeout(() => {
      const engineIsRunning = engineProcess !== null && engineProcess.exitCode === null;
      if (allowStandaloneGoClawFallback && !goclawPortReportedByEngine && !goclawStopping && engineIsRunning) {
        if (hasGoClawRequiredEnv()) {
          console.warn("[Electron] No GoClaw port from engine supervisor; falling back to standalone GoClaw process");
          void startGoClaw();
        } else {
          if (!goclawConfigErrorLogged) {
            console.error("[Electron] No GoClaw port from engine supervisor and GOCLAW_POSTGRES_DSN is missing.");
            console.error("[Electron] Configure GOCLAW_POSTGRES_DSN to enable GoClaw features.");
            goclawConfigErrorLogged = true;
          }
        }
      }
      singleEngineFallbackTimer = null;
    }, 8000);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  engineStopping = true;
  goclawStopping = true;
  if (goclawRestartTimer) {
    clearTimeout(goclawRestartTimer);
    goclawRestartTimer = null;
  }
  if (singleEngineFallbackTimer) {
    clearTimeout(singleEngineFallbackTimer);
    singleEngineFallbackTimer = null;
  }
  engineProcess?.kill();
  goclawProcess?.kill();
  if (process.platform !== "darwin") app.quit();
});
