import { app, BrowserWindow, shell, ipcMain } from "electron";
import { spawn, spawnSync, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import net from "net";
import { engineEnvironment } from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Secrets are supplied explicitly by the launching environment, never auto-imported.

const isDev = !app.isPackaged;
// In development, default to dual-process mode unless explicitly enabled.
// This avoids coupling desktop startup to Aistclaw/PostgreSQL availability.
const singleEngineMode = process.env.AIST_SINGLE_ENGINE
  ? process.env.AIST_SINGLE_ENGINE !== "0"
  : false;
const allowStandaloneAistclawFallback = process.env.AIST_ALLOW_STANDALONE_AISTCLAW_FALLBACK === "1";

let engineProcess: ChildProcess | null = null;
let aistclawProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let engineRestartDelay = 1000;
let aistclawRestartDelay = 1000;
let engineStopping = false;
let aistclawStopping = false;
let aistclawStartInProgress = false;
let aistclawRestartTimer: NodeJS.Timeout | null = null;
let lastEnginePort: number | null = null; // cache so we can re-send after window load
let lastAistclawPort: number | null = null;
let aistclawPortReportedByEngine = false;
let singleEngineFallbackTimer: NodeJS.Timeout | null = null;
let aistclawConfigErrorLogged = false;
let aistclawDbErrorLogged = false;
let devEngineSourceLaunchFailed = false;
let engineEmbeddedFlagSupported: boolean | null = null;
let windowControlHandlersRegistered = false;
// Desktop always uses the embedded runtime; CLI `aist --server` owns llama-server mode.
const preferEmbeddedEngine = true;

const AISTCLAW_DEFAULT_PORT = 18790;

function resolveWindowIconPath() {
  const candidates = isDev
    ? [
        path.join(__dirname, "../public/favicon.ico"),
        path.join(__dirname, "../public/logo.png"),
      ]
    : [
        path.join(__dirname, "../dist/favicon.ico"),
        path.join(__dirname, "../dist/logo.png"),
      ];

  for (const iconPath of candidates) {
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  }

  return undefined;
}

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

function hasAistclawRequiredEnv() {
  return Boolean(process.env.AISTCLAW_POSTGRES_DSN && process.env.AISTCLAW_POSTGRES_DSN.trim().length > 0);
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
  if (engineStopping) return;
  const engineBinary = path.join(process.resourcesPath, "engine", process.platform === "win32" ? "engine.exe" : "engine");
  const devEngineCwd = path.join(__dirname, "../../../backend/goengine");
  const devBackendBin = path.join(__dirname, "../../../backend/goengine/bin");
  const runEngineFromSource = isDev && process.env.AIST_DEV_ENGINE_FROM_SOURCE === "1" && !devEngineSourceLaunchFailed;

  if (runEngineFromSource) {
    console.log(`[Electron] Starting Go engine from source: ${devEngineCwd}`);
  } else {
    const target = isDev ? path.join(__dirname, "../../../backend/goengine/engine.exe") : engineBinary;
    console.log(`[Electron] Starting Go engine binary: ${target}`);
  }
  console.log(`[Electron] Local inference mode: ${preferEmbeddedEngine ? "embedded-cgo" : "llama-server-subprocess"}`);

  const runtimeBinPath = isDev ? devBackendBin : path.join(process.resourcesPath, "engine");
  const currentPath = process.env.PATH || "";
  const mergedPath = `${runtimeBinPath}${path.delimiter}${currentPath}`;

  const env = {
    ...engineEnvironment(process.env, app.getPath("userData")),
    AIST_SINGLE_ENGINE: singleEngineMode ? "1" : "0",
    PATH: mergedPath,
  };
  // In dev, prefer `go run ./cmd/engine` so the engine supervisor behavior stays in sync
  // with source changes (avoids stale engine.exe fallback behavior).
  const binaryTarget = isDev ? path.join(__dirname, "../../../backend/goengine/engine.exe") : engineBinary;
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
          } else if (msg?.type === "aistclaw:port") {
            lastAistclawPort = msg.port;
            aistclawPortReportedByEngine = true;
            if (singleEngineFallbackTimer) {
              clearTimeout(singleEngineFallbackTimer);
              singleEngineFallbackTimer = null;
            }
            mainWindow?.webContents.send("aistclaw:port", msg.port);
            console.log(`[Electron] Aistclaw available on port ${msg.port} (via engine supervisor)`);
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
    aistclawPortReportedByEngine = false;
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

async function startAistclaw() {
  if (aistclawStopping) return;
  const sourceExists = fs.existsSync(path.join(__dirname, "../../../backend/microservices/aistclaw/go.mod"));
  const binaryExists = fs.existsSync(isDev ? path.join(__dirname, "../extensions/backend/aistclaw.exe") : path.join(process.resourcesPath, "backend", process.platform === "win32" ? "aistclaw.exe" : "aistclaw"));
  if ((isDev && !sourceExists && !binaryExists) || (!isDev && !binaryExists)) {
    if (!aistclawConfigErrorLogged) console.info("[Electron] Optional Aistclaw runtime is not installed; the local Studio engine remains available.");
    aistclawConfigErrorLogged = true;
    return;
  }
  if (aistclawStartInProgress) {
    return;
  }

  if (aistclawProcess && aistclawProcess.exitCode === null) {
    return;
  }

  aistclawStartInProgress = true;

  if (await isPortInUse(AISTCLAW_DEFAULT_PORT)) {
    // Another process (often the engine supervisor) already owns the port.
    lastAistclawPort = AISTCLAW_DEFAULT_PORT;
    mainWindow?.webContents.send("aistclaw:port", AISTCLAW_DEFAULT_PORT);
    console.log(`[Electron] Aistclaw port ${AISTCLAW_DEFAULT_PORT} already in use; reusing existing instance.`);
    aistclawStartInProgress = false;
    return;
  }

  if (!hasAistclawRequiredEnv()) {
    if (!aistclawConfigErrorLogged) {
      console.error("[Electron] AISTCLAW_POSTGRES_DSN is missing. Skipping Aistclaw startup until it is configured.");
      console.error("[Electron] Set AISTCLAW_POSTGRES_DSN in your shell or .env.local, then restart npm run dev:electron.");
      aistclawConfigErrorLogged = true;
    }
    aistclawStartInProgress = false;
    return;
  }

  const aistclawSourceDir = path.join(__dirname, "../../../backend/microservices/aistclaw");
  const devAistclawBinary = path.join(__dirname, "../extensions/backend/aistclaw.exe");
  // On Windows, source run is more reliable for migration path resolution in dev.
  const useDevAistclawBinary = isDev
    && (process.env.AIST_DEV_AISTCLAW_BINARY === "1" || !sourceExists)
    && fs.existsSync(devAistclawBinary);
  const aistclawBinary = isDev
    ? (useDevAistclawBinary ? devAistclawBinary : path.join(__dirname, "../../../backend/microservices/aistclaw/aistclaw.exe"))
    : path.join(process.resourcesPath, "backend", process.platform === "win32" ? "aistclaw.exe" : "aistclaw");

  const cwd = isDev
    ? (useDevAistclawBinary ? path.dirname(devAistclawBinary) : aistclawSourceDir)
    : process.resourcesPath;

  const env: NodeJS.ProcessEnv = {
    ...engineEnvironment(process.env, app.getPath("userData")),
    AISTCLAW_PORT: String(AISTCLAW_DEFAULT_PORT),
  };

  // In dev, let aistclaw resolve migrations from its own defaults.
  // Explicit Windows file:// migration paths have been fragile across environments.

  const launch = () => {
    if (isDev && !useDevAistclawBinary) {
      return spawn("go", ["run", "./cmd/engine"], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        cwd,
      });
    }
    return spawn(aistclawBinary, [], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    });
  };

  console.log(`[Electron] Starting Aistclaw backend on ${AISTCLAW_DEFAULT_PORT}`);

  let aistclawDbConnectivityFailed = false;

  const trackAistclawOutput = (text: string) => {
    // If DB connectivity fails during boot, restarting the process repeatedly is noisy
    // and does not recover until PostgreSQL becomes available.
    if (
      text.includes("schema compatibility check failed") ||
      text.includes("dial tcp") ||
      text.includes("connectex") ||
      text.includes("failed to connect to `user=")
    ) {
      aistclawDbConnectivityFailed = true;
    }
  };

  try {
    aistclawProcess = launch();
  } catch (err) {
    console.error("[Electron] Failed to start Aistclaw process:", err);
    aistclawStartInProgress = false;
    return;
  }

  const proc = aistclawProcess;

  proc.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    trackAistclawOutput(text);
    process.stdout.write(`[aistclaw] ${text}`);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    trackAistclawOutput(text);
    process.stderr.write(`[aistclaw] ${text}`);
  });

  proc.on("spawn", () => {
    aistclawStartInProgress = false;
    lastAistclawPort = AISTCLAW_DEFAULT_PORT;
    aistclawRestartDelay = 1000;
    mainWindow?.webContents.send("aistclaw:port", AISTCLAW_DEFAULT_PORT);
  });

  proc.on("error", (err) => {
    aistclawStartInProgress = false;
    console.error("[Electron] Aistclaw error:", err);
  });

  proc.on("exit", (code, signal) => {
    aistclawStartInProgress = false;
    if (aistclawProcess !== proc) {
      return;
    }
    aistclawProcess = null;
    console.log(`[Electron] Aistclaw exited (code=${code}, signal=${signal})`);
    if (aistclawStopping) return;
    if (aistclawDbConnectivityFailed) {
      if (!aistclawDbErrorLogged) {
        console.error("[Electron] Aistclaw could not connect to PostgreSQL. Restart loop paused.");
        console.error("[Electron] Start PostgreSQL and ensure AISTCLAW_POSTGRES_DSN is correct, then restart npm run dev:electron.");
        aistclawDbErrorLogged = true;
      }
      return;
    }
    console.log(`[Electron] Restarting Aistclaw in ${aistclawRestartDelay}ms...`);
    if (aistclawRestartTimer) {
      clearTimeout(aistclawRestartTimer);
    }
    aistclawRestartTimer = setTimeout(() => {
      aistclawRestartTimer = null;
      aistclawRestartDelay = Math.min(aistclawRestartDelay * 2, 30_000);
      void startAistclaw();
    }, aistclawRestartDelay);
  });
}

function createWindow() {
  const icon = resolveWindowIconPath();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    icon,
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
    if (lastAistclawPort !== null) {
      win.webContents.send("aistclaw:port", lastAistclawPort);
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
    // has already started Aistclaw before launching a standalone Aistclaw process.
    setTimeout(() => {
      if (!aistclawPortReportedByEngine && !aistclawStopping) {
        void startAistclaw();
      }
    }, 1500);
  } else {
    if (!allowStandaloneAistclawFallback) {
      console.log("[Electron] Standalone Aistclaw fallback is disabled in single-engine mode.");
    }
    // If single-engine mode fails to report Aistclaw readiness, fallback to direct Aistclaw process.
    singleEngineFallbackTimer = setTimeout(() => {
      const engineIsRunning = engineProcess !== null && engineProcess.exitCode === null;
      if (allowStandaloneAistclawFallback && !aistclawPortReportedByEngine && !aistclawStopping && engineIsRunning) {
        if (hasAistclawRequiredEnv()) {
          console.warn("[Electron] No Aistclaw port from engine supervisor; falling back to standalone Aistclaw process");
          void startAistclaw();
        } else {
          if (!aistclawConfigErrorLogged) {
            console.error("[Electron] No Aistclaw port from engine supervisor and AISTCLAW_POSTGRES_DSN is missing.");
            console.error("[Electron] Configure AISTCLAW_POSTGRES_DSN to enable Aistclaw features.");
            aistclawConfigErrorLogged = true;
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

let shutdownComplete = false;
async function stopBackends() {
  engineStopping = true;
  aistclawStopping = true;
  if (aistclawRestartTimer) {
    clearTimeout(aistclawRestartTimer);
    aistclawRestartTimer = null;
  }
  if (singleEngineFallbackTimer) {
    clearTimeout(singleEngineFallbackTimer);
    singleEngineFallbackTimer = null;
  }
  await Promise.all([engineProcess, aistclawProcess].map(proc => new Promise<void>(resolve => {
    if (!proc || proc.exitCode !== null) { resolve(); return; }
    const timeout = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 3000);
    proc.once("exit", () => { clearTimeout(timeout); resolve(); });
    proc.kill("SIGTERM");
  })));
}
app.on("before-quit", event => {
  if (shutdownComplete) return;
  event.preventDefault();
  void stopBackends().finally(() => { shutdownComplete = true; app.quit(); });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
