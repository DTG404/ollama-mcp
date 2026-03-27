import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerDraftCode(server, ollama, vramManager, config) {
  server.tool(
    "draft_code",
    "Generate a first draft of code using a local model. Returns a draft that may need refinement — use it as a starting point, not production-ready output.",
    {
      prompt: z.string().min(1).describe("What to generate"),
      language: z
        .string()
        .optional()
        .describe("Target language (e.g., python, go, typescript)"),
      context: z
        .string()
        .optional()
        .describe("Existing code for reference (max 50KB)"),
    },
    async ({ prompt, language, context }) => {
      const userPrompt = context
        ? `Existing code for reference:\n\n${context}\n\n---\n\nGenerate: ${prompt}`
        : prompt;

      return await runTool({
        toolName: "draft_code",
        vramManager,
        ollama,
        modelChain: config.groups.code.models,
        temperature: config.groups.code.temperature,
        systemPrompt: PROMPTS.draft_code(language),
        userPrompt,
        inputChecks: context
          ? {
              context: {
                value: context,
                limit: config.inputLimits.draft_code_context,
              },
            }
          : undefined,
      });
    }
  );
}
