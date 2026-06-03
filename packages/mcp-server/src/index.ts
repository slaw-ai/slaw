import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SlawApiClient } from "./client.js";
import { readConfigFromEnv, type SlawMcpConfig } from "./config.js";
import { createToolDefinitions } from "./tools.js";

export function createSlawMcpServer(config: SlawMcpConfig = readConfigFromEnv()) {
  const server = new McpServer({
    name: "slaw",
    version: "0.1.0",
  });

  const client = new SlawApiClient(config);
  const tools = createToolDefinitions(client);
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema.shape, tool.execute);
  }

  return {
    server,
    tools,
    client,
  };
}

export async function runServer(config: SlawMcpConfig = readConfigFromEnv()) {
  const { server } = createSlawMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
