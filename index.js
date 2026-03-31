#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./lib/config.js";
import { OllamaClient } from "./lib/ollama-client.js";
import { VramManager } from "./lib/vram-manager.js";
import { registerClassifyTask } from "./lib/tools/classify-task.js";
import { registerDraftCommit } from "./lib/tools/draft-commit.js";
import { registerSummarizeFile } from "./lib/tools/summarize-file.js";
import { registerDraftContent } from "./lib/tools/draft-content.js";
import { registerDraftCode } from "./lib/tools/draft-code.js";
import { registerTriageIssues } from "./lib/tools/triage-issues.js";
import { registerListModels } from "./lib/tools/list-models.js";
import { registerCheckUpdates } from "./lib/tools/check-updates.js";
import { registerGetConfig } from "./lib/tools/get-config.js";
import { registerReloadConfig } from "./lib/tools/reload-config.js";
import { registerExplainCode } from "./lib/tools/explain-code.js";
import { registerGenerateReadme } from "./lib/tools/generate-readme.js";
import { registerReviewCode } from "./lib/tools/review-code.js";
import { registerRefactorCode } from "./lib/tools/refactor-code.js";

const config = await loadConfig();
const ollama = new OllamaClient(config.ollama.host, config.ollama.timeoutMs);
const vramManager = new VramManager(ollama, config.vram);

// Check Ollama version on startup
try {
  const version = await ollama.getVersion();
  console.error(`[ollama-mcp] Ollama ${version} detected`);
} catch {
  console.error("[ollama-mcp] Warning: could not reach Ollama at startup");
}

const server = new McpServer({
  name: "ollama",
  version: "1.0.0",
});

// Register tools
registerClassifyTask(server, ollama, vramManager, config);
registerDraftCommit(server, ollama, vramManager, config);
registerSummarizeFile(server, ollama, vramManager, config);
registerDraftContent(server, ollama, vramManager, config);
registerDraftCode(server, ollama, vramManager, config);
registerTriageIssues(server, ollama, vramManager, config);
registerListModels(server, ollama, vramManager, config);
registerCheckUpdates(server, ollama);
registerGetConfig(server, config);
registerReloadConfig(server, config);
registerExplainCode(server, ollama, vramManager, config);
registerGenerateReadme(server, ollama, vramManager, config);
registerReviewCode(server, ollama, vramManager, config);
registerRefactorCode(server, ollama, vramManager, config);

const transport = new StdioServerTransport();
await server.connect(transport);
