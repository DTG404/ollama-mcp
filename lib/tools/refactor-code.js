import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerRefactorCode(server, ollama, vramManager, config) {
  server.tool(
    "refactor_code",
    "Apply mechanical refactoring to code using a local model. Good for renames, extracting functions, adding types/JSDoc, and reformatting.",
    {
      code: z.string().min(1).describe("Code to refactor (max 100KB)"),
      instruction: z
        .string()
        .min(1)
        .describe("What refactoring to apply (e.g., 'rename variables to be descriptive', 'extract the validation into a separate function', 'add TypeScript types')"),
      language: z
        .string()
        .optional()
        .describe("Programming language"),
    },
    async ({ code, instruction, language }) => {
      const langHint = language ? ` Language: ${language}.` : "";
      const userPrompt = `Refactoring instruction: ${instruction}${langHint}\n\n---\n\nCode:\n\n${code}`;

      return await runTool({
        toolName: "refactor_code",
        vramManager,
        ollama,
        modelChain: config.groups.code.models,
        temperature: config.groups.code.temperature,
        systemPrompt: PROMPTS.refactor_code(),
        userPrompt,
        inputChecks: {
          code: { value: code, limit: config.inputLimits.refactor_code_code },
        },
      });
    }
  );
}
