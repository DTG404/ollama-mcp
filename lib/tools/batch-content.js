import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerBatchContent(server, ollama, vramManager, config) {
  server.tool(
    "batch_content",
    "Generate multiple content pieces from a template and variations using a local model. Pass a template with {{placeholders}} and a JSON array of variation objects. Returns all generated content separated by ---SEPARATOR--- lines.",
    {
      template: z
        .string()
        .min(1)
        .describe("Template with {{placeholder}} variables (max 50KB)"),
      variations: z
        .string()
        .min(1)
        .describe("JSON array of objects, each mapping placeholder names to values"),
      instruction: z
        .string()
        .optional()
        .describe("Additional instructions for content generation"),
    },
    async ({ template, variations, instruction }) => {
      let parsedVariations;
      try {
        parsedVariations = JSON.parse(variations);
        if (!Array.isArray(parsedVariations)) {
          return {
            content: [{ type: "text", text: "Error: variations must be a JSON array" }],
            isError: true,
          };
        }
      } catch {
        return {
          content: [{ type: "text", text: "Error: variations is not valid JSON" }],
          isError: true,
        };
      }

      const userPrompt = [
        `Template:\n\n${template}`,
        `\n\n---\n\nVariations (${parsedVariations.length} items):\n\n${JSON.stringify(parsedVariations, null, 2)}`,
        instruction ? `\n\n---\n\nAdditional instructions: ${instruction}` : "",
      ].join("");

      return await runTool({
        toolName: "batch_content",
        vramManager,
        ollama,
        modelChain: config.groups.content.models,
        temperature: config.groups.content.temperature,
        systemPrompt: PROMPTS.batch_content(),
        userPrompt,
        inputChecks: {
          template: { value: template, limit: config.inputLimits.batch_content_template },
        },
      });
    }
  );
}
