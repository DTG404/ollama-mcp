import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".ollama-mcp");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const GroupSchema = z.object({
  models: z.array(z.string()).min(1),
  temperature: z.number().min(0).max(2),
});

const ConfigSchema = z.object({
  ollama: z.object({
    host: z.string(),
    timeoutMs: z.number().int().positive(),
  }),
  vram: z.object({
    bufferMb: z.number().int().positive(),
    cacheTtlMs: z.number().int().positive(),
  }),
  groups: z.object({
    code: GroupSchema,
    content: GroupSchema,
    utility: GroupSchema,
    routing: GroupSchema,
  }),
  inputLimits: z.object({
    draft_code_context: z.number().int().positive(),
    triage_issues_code: z.number().int().positive(),
    summarize_file_content: z.number().int().positive(),
    draft_content_reference: z.number().int().positive(),
    draft_commit_message_diff: z.number().int().positive(),
    classify_task_task: z.number().int().positive(),
  }),
});

const DEFAULTS = {
  ollama: {
    host: "http://localhost:11434",
    timeoutMs: 120000,
  },
  vram: {
    bufferMb: 1024,
    cacheTtlMs: 5000,
  },
  groups: {
    code: {
      models: ["deepcoder:14b", "qwen3:14b", "deepseek-r1:14b", "devstral-small-2:24b", "qwen3.5:4b"],
      temperature: 0.3,
    },
    content: {
      models: ["qwen3.5:9b", "gemma3:12b", "qwen3.5:4b", "qwen3.5:0.8b"],
      temperature: 0.7,
    },
    utility: {
      models: ["qwen3.5:4b", "qwen3.5:0.8b"],
      temperature: 0.2,
    },
    routing: {
      models: ["qwen3.5:0.8b"],
      temperature: 0.0,
    },
  },
  inputLimits: {
    draft_code_context: 51200,
    triage_issues_code: 102400,
    summarize_file_content: 204800,
    draft_content_reference: 51200,
    draft_commit_message_diff: 51200,
    classify_task_task: 5120,
  },
};

export { ConfigSchema, DEFAULTS, CONFIG_DIR, CONFIG_PATH };

export async function reloadConfig(currentConfig) {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const result = ConfigSchema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, error: result.error.message };
    }
    // Mutate in place so all references update
    Object.assign(currentConfig, result.data);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function loadConfig() {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const result = ConfigSchema.safeParse(parsed);
    if (!result.success) {
      console.error(`[ollama-mcp] Invalid config at ${CONFIG_PATH}: ${result.error.message}`);
      console.error(`[ollama-mcp] Using default configuration.`);
      return { ...DEFAULTS };
    }
    return result.data;
  } catch (err) {
    if (err.code === "ENOENT") {
      await fs.mkdir(CONFIG_DIR, { recursive: true });
      await fs.writeFile(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2), "utf-8");
      console.error(`[ollama-mcp] Created default config at ${CONFIG_PATH}`);
      return { ...DEFAULTS };
    }
    console.error(`[ollama-mcp] Error reading config: ${err.message}`);
    console.error(`[ollama-mcp] Using default configuration.`);
    return { ...DEFAULTS };
  }
}
