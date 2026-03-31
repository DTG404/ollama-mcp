import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerGenerateReadme(server, ollama, vramManager, config) {
  server.tool(
    "generate_readme",
    "Generate a project README from metadata and directory structure. Pass in package.json contents, directory tree, and any other project info.",
    {
      project_info: z
        .string()
        .min(1)
        .describe("Project metadata: package.json/go.mod contents, directory tree, description"),
      style: z
        .enum(["minimal", "standard", "detailed"])
        .optional()
        .default("standard")
        .describe("README detail level"),
    },
    async ({ project_info, style }) => {
      const styleHint =
        style === "minimal"
          ? " Keep it brief — title, one-liner description, install, usage. Under 50 lines."
          : style === "detailed"
          ? " Be thorough — include badges placeholders, screenshots section, API reference skeleton, contributing guide, and detailed usage examples."
          : "";

      return await runTool({
        toolName: "generate_readme",
        vramManager,
        ollama,
        modelChain: config.groups.content.models,
        temperature: config.groups.content.temperature,
        systemPrompt: PROMPTS.generate_readme() + styleHint,
        userPrompt: project_info,
      });
    }
  );
}
