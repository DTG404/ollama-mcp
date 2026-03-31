import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerExplainCode(server, ollama, vramManager, config) {
  server.tool(
    "explain_code",
    "Explain what code does using a local model. Use for exploring unfamiliar codebases — cheaper than Claude for 'what does this do?' questions.",
    {
      code: z.string().min(1).describe("Code to explain (max 100KB)"),
      detail: z
        .enum(["brief", "thorough"])
        .optional()
        .default("thorough")
        .describe("Level of detail"),
      question: z
        .string()
        .optional()
        .describe("Specific question about the code (e.g., 'why does it cache here?')"),
    },
    async ({ code, detail, question }) => {
      const userPrompt = question
        ? `Code:\n\n${code}\n\n---\n\nSpecific question: ${question}`
        : code;

      return await runTool({
        toolName: "explain_code",
        vramManager,
        ollama,
        modelChain: config.groups.code.models,
        temperature: config.groups.code.temperature,
        systemPrompt: PROMPTS.explain_code(detail),
        userPrompt,
        inputChecks: {
          code: { value: code, limit: config.inputLimits.explain_code_code },
        },
      });
    }
  );
}
