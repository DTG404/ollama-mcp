import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerGenerateChangelog(server, ollama, vramManager, config) {
  server.tool(
    "generate_changelog",
    "Generate a grouped changelog from git commit messages using a local model. Pass in the output of `git log --oneline`.",
    {
      commits: z.string().min(1).describe("Git commit messages (one per line, from git log --oneline)"),
      version: z
        .string()
        .optional()
        .describe("Version label for the changelog header (e.g., 'v2.0.0')"),
    },
    async ({ commits, version }) => {
      return await runTool({
        toolName: "generate_changelog",
        vramManager,
        ollama,
        modelChain: config.groups.content.models,
        temperature: config.groups.content.temperature,
        systemPrompt: PROMPTS.generate_changelog(version),
        userPrompt: commits,
      });
    }
  );
}
