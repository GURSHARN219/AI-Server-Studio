import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["index.js"]
  });

  const client = new Client({
    name: "test-client",
    version: "1.0.0"
  }, {
    capabilities: {}
  });

  await client.connect(transport);
  
  console.log("--- Testing run_python ---");
  const pyResult = await client.callTool({
    name: "run_python",
    arguments: { code: "print('Hello from Python')\n2+2" }
  });
  console.log("Python Tool Result:", JSON.stringify(pyResult, null, 2));

  console.log("\n--- Testing run_javascript ---");
  const jsResult = await client.callTool({
    name: "run_javascript",
    arguments: { code: "console.log('Hello from JS'); 3+3;" }
  });
  console.log("JS Tool Result:", JSON.stringify(jsResult, null, 2));

  process.exit(0);
}
main().catch(console.error);
