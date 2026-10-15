// Runs inside a worker_thread — isolated from main process
// Receives: { code } via workerData
// Posts back: { stdout, stderr, result, logs, error }
import { workerData, parentPort } from "worker_threads";
import vm from "vm";

const logs = [];
const stdout = [];
const stderr = [];

const sandbox = {
  console: {
    log: (...a) => { const s = a.map(String).join(" "); logs.push(s); stdout.push(s); },
    error: (...a) => { const s = a.map(String).join(" "); logs.push("[err] " + s); stderr.push(s); },
    warn: (...a) => { const s = a.map(String).join(" "); logs.push("[warn] " + s); stdout.push(s); },
  },
  Math, JSON, Array, Object, String, Number, Boolean, Date, RegExp, Error,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  setTimeout: undefined, setInterval: undefined, fetch: undefined, // blocked
};

vm.createContext(sandbox);

let result;
let error;
try {
  result = vm.runInContext(workerData.code, sandbox, {
    timeout: 5000,
    filename: "sandbox.js",
  });
  // If result is a Promise, we can't await it in sync vm — mark it
  if (result && typeof result.then === "function") {
    result = "[async result — use console.log() to output values]";
  }
} catch (e) {
  error = e.message;
}

parentPort.postMessage({
  stdout: stdout.join("\n"),
  stderr: stderr.join("\n"),
  result: result !== undefined ? String(result) : undefined,
  logs,
  error,
});
