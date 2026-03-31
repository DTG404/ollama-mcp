import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerReviewCode(server, ollama, vramManager, config) {
  server.tool(
    "review_code",
    "First-pass code review using a local model. Surfaces bugs, correctness issues, and improvement opportunities. Use as a pre-filter before Claude reviews.",
    {
      code: z.string().min(1).describe("Code to review (max 100KB)"),
      context: z
        .string()
        .optional()
        .describe("What this code does or what changed (helps focus the review)"),
    },
    async ({ code, context }) => {
      const userPrompt = context
        ? `Context: ${context}\n\n---\n\nCode to review:\n\n${code}`
        : code;

      return await runTool({
        toolName: "review_code",
        vramManager,
        ollama,
        modelChain: config.groups.code.models,
        temperature: config.groups.code.temperature,
        systemPrompt: PROMPTS.review_code(),
        userPrompt,
        inputChecks: {
          code: { value: code, limit: config.inputLimits.review_code_code },
        },
      });
    }
  );
}
