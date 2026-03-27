import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerDraftContent(server, ollama, vramManager, config) {
  server.tool(
    "draft_content",
    "Draft technical content using a local model. Returns a rough draft intended for Claude to review and refine.",
    {
      prompt: z.string().min(1).describe("What to write"),
      style: z
        .enum(["readme", "lesson", "lab", "docs"])
        .optional()
        .describe("Content style hint"),
      reference: z
        .string()
        .optional()
        .describe("Existing content to match tone/format (max 50KB)"),
    },
    async ({ prompt, style, reference }) => {
      const userPrompt = reference
        ? `Reference material:\n\n${reference}\n\n---\n\nTask: ${prompt}`
        : prompt;

      return await runTool({
        toolName: "draft_content",
        vramManager,
        ollama,
        modelChain: config.groups.content.models,
        temperature: config.groups.content.temperature,
        systemPrompt: PROMPTS.draft_content(style),
        userPrompt,
        inputChecks: reference
          ? {
              reference: {
                value: reference,
                limit: config.inputLimits.draft_content_reference,
              },
            }
          : undefined,
      });
    }
  );
}
