import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerClassifyTask(server, ollama, vramManager, config) {
  server.tool(
    "classify_task",
    "Classify task complexity using a local model. Returns a complexity rating to help decide whether to handle locally or use Claude.",
    {
      task: z
        .string()
        .min(1)
        .describe("Task description to classify (max 5KB)"),
    },
    async ({ task }) => {
      const result = await runTool({
        toolName: "classify_task",
        vramManager,
        ollama,
        modelChain: config.groups.routing.models,
        temperature: config.groups.routing.temperature,
        systemPrompt: PROMPTS.classify_task(),
        userPrompt: task,
        inputChecks: {
          task: { value: task, limit: config.inputLimits.classify_task_task },
        },
      });

      // If it's an error, return as-is
      if (result.isError) return result;

      // Try to parse structured JSON from the model output
      const rawText = result.content[0].text;
      const modelOutput = rawText.split("\n\n```json meta")[0].trim();

      try {
        const parsed = JSON.parse(modelOutput);
        if (parsed.complexity && parsed.reasoning) {
          return result;
        }
      } catch {
        // Not valid JSON
      }

      // Try to extract JSON from markdown fences
      const jsonMatch = modelOutput.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1].trim());
          if (parsed.complexity && parsed.reasoning) {
            const metaMatch = rawText.match(/\n\n```json meta\n[\s\S]*$/);
            const metaBlock = metaMatch ? metaMatch[0] : "";
            return {
              content: [{
                type: "text",
                text: JSON.stringify(parsed) + metaBlock,
              }],
            };
          }
        } catch {
          // Still not valid
        }
      }

      // Fallback: return default classification with metadata
      const metaMatch = rawText.match(/\n\n```json meta\n[\s\S]*$/);
      const metaBlock = metaMatch ? metaMatch[0] : "";
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            complexity: "moderate",
            reasoning: "classification failed — defaulting to moderate",
          }) + metaBlock,
        }],
      };
    }
  );
}
