#!/usr/bin/env node
import { runServer } from "./index.js";

void runServer().catch((error) => {
  console.error("Failed to start Slaw MCP server:", error);
  process.exit(1);
});
