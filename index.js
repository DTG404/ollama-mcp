#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "ollama",
  version: "1.0.0",
});

// Tools will be registered here in later tasks

const transport = new StdioServerTransport();
await server.connect(transport);
