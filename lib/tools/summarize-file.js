import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerSummarizeFile(server, ollama, vramManager, config) {
  server.tool(
    "summarize_file",
    "Summarize file contents using a local model. Use this to compress large files before processing them — saves tokens by reducing input size.",
    {
      content: z.string().min(1).describe("File contents to summarize (max 200KB)"),
      max_length: z
        .number()
        .int()
        .min(50)
        .max(1000)
        .optional()
        .default(200)
        .describe("Target summary length in words (default 200)"),
    },
    async ({ content, max_length }) => {
      return await runTool({
        toolName: "summarize_file",
        vramManager,
        ollama,
        modelChain: config.groups.content.models,
        temperature: config.groups.content.temperature,
        systemPrompt: PROMPTS.summarize_file(max_length),
        userPrompt: content,
        inputChecks: {
          content: {
            value: content,
            limit: config.inputLimits.summarize_file_content,
          },
        },
      });
    }
  );
}
