import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerDraftCommit(server, ollama, vramManager, config) {
  server.tool(
    "draft_commit_message",
    "Generate a conventional commit message from a git diff using a local model.",
    {
      diff: z.string().min(1).describe("Git diff to summarize (max 50KB)"),
      style: z
        .enum(["conventional", "descriptive"])
        .optional()
        .default("conventional")
        .describe("Commit message style"),
    },
    async ({ diff, style }) => {
      return await runTool({
        toolName: "draft_commit_message",
        vramManager,
        ollama,
        modelChain: config.groups.utility.models,
        temperature: config.groups.utility.temperature,
        systemPrompt: PROMPTS.draft_commit_message(style),
        userPrompt: diff,
        inputChecks: {
          diff: {
            value: diff,
            limit: config.inputLimits.draft_commit_message_diff,
          },
        },
      });
    }
  );
}
