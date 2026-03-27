import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerTriageIssues(server, ollama, vramManager, config) {
  server.tool(
    "triage_issues",
    "Scan code for specific issue types using a local model. Returns candidate issues that should be verified — may contain false positives.",
    {
      code: z.string().min(1).describe("Source code to analyze (max 100KB)"),
      focus: z
        .enum([
          "type-mismatches",
          "security",
          "null-errors",
          "unused-code",
          "logic-bugs",
        ])
        .describe("What to look for"),
    },
    async ({ code, focus }) => {
      return await runTool({
        toolName: "triage_issues",
        vramManager,
        ollama,
        modelChain: config.groups.code.models,
        temperature: config.groups.code.temperature,
        systemPrompt: PROMPTS.triage_issues(focus),
        userPrompt: code,
        inputChecks: {
          code: {
            value: code,
            limit: config.inputLimits.triage_issues_code,
          },
        },
      });
    }
  );
}
