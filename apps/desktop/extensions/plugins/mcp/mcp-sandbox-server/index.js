import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadPyodide } from "pyodide";
import vm from "vm";

// Create MCP Server instance
const server = new Server({
  name: "mcp-sandbox-server",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

let pyodideInstance = null;

async function getPyodide() {
  if (!pyodideInstance) {
    pyodideInstance = await loadPyodide();
  }
  return pyodideInstance;
}

// Tool definitions
const runPythonTool = {
  name: "run_python",
  description: "Runs Python code in a Pyodide sandbox and returns stdout/stderr and final expression result.",
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "The Python code to execute"
      }
    },
    required: ["code"]
  }
};

const runJsTool = {
  name: "run_javascript",
  description: "Runs JavaScript code in a Node.js VM sandbox and returns console logs and final expression result.",
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "The JavaScript code to execute"
      }
    },
    required: ["code"]
  }
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [runPythonTool, runJsTool]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "run_python") {
    const code = args.code;
    const pyodide = await getPyodide();
    let stdoutData = [];
    let stderrData = [];
    
    // Pyodide captures
    pyodide.setStdout({ batched: (msg) => stdoutData.push(msg) });
    pyodide.setStderr({ batched: (msg) => stderrData.push(msg) });

    try {
      const result = await pyodide.runPythonAsync(code);
      const resultString = result !== undefined ? String(result) : "None";
      const stdoutString = stdoutData.join("\n");
      const stderrString = stderrData.join("\n");
      
      let text = "";
      if (stdoutString) text += "STDOUT:\n```text\n" + stdoutString + "\n```\n";
      if (stderrString) text += "STDERR:\n```text\n" + stderrString + "\n```\n";
      text += "RESULT:\n```text\n" + resultString + "\n```";

      return {
        content: [{ type: "text", text }],
        isError: stderrString.length > 0
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}\nSTDOUT:\n${stdoutData.join("\n")}\nSTDERR:\n${stderrData.join("\n")}` }],
        isError: true
      };
    }
  } else if (name === "run_javascript") {
    const code = args.code;
    let consoleLogs = [];
    
    // Create a sandboxed context
    const sandbox = {
      console: {
        log: (...args) => consoleLogs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        error: (...args) => consoleLogs.push("ERROR: " + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        warn: (...args) => consoleLogs.push("WARN: " + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        info: (...args) => consoleLogs.push("INFO: " + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
      },
      setTimeout,
      clearTimeout,
      Buffer
    };
    
    const context = vm.createContext(sandbox);

    try {
      const result = vm.runInContext(code, context, { timeout: 5000 }); // 5s timeout
      
      const resultString = result !== undefined ? (typeof result === 'object' ? JSON.stringify(result) : String(result)) : "undefined";
      const logsString = consoleLogs.join("\n");
      
      let text = "";
      if (logsString) text += "LOGS:\n```text\n" + logsString + "\n```\n";
      text += "RESULT:\n```text\n" + resultString + "\n```";

      return {
        content: [{ type: "text", text }],
        isError: false
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}\nLOGS:\n${consoleLogs.join("\n")}` }],
        isError: true
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Sandbox Server running on ai serve rstdio");
}

run().catch(console.error);
