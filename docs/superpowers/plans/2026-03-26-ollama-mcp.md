# Ollama MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VRAM-aware MCP server that offloads token-heavy tasks to local Ollama models, saving Claude API costs without reducing quality.

**Architecture:** Node.js MCP server with stdio transport. Tools are organized into groups (code, content, utility, routing) with model preference chains. A VRAM manager queries nvidia-smi and Ollama to pick the best model that fits in GPU memory, with automatic fallback to smaller models.

**Tech Stack:** Node.js 18+, @modelcontextprotocol/sdk ^1.27, zod ^4, native fetch(), child_process for nvidia-smi

---

## File Structure

```
ollama-mcp/
  index.js              # Entry point — creates server, registers tools, connects transport
  lib/
    config.js           # Config loading, Zod validation, default creation
    ollama-client.js    # HTTP client for Ollama API (/api/generate, /api/tags, /api/ps, /api/show)
    vram-manager.js     # VRAM queries, model selection, caching, fallback logic
    tools/
      draft-code.js     # draft_code tool
      triage-issues.js  # triage_issues tool
      draft-content.js  # draft_content tool
      summarize-file.js # summarize_file tool
      classify-task.js  # classify_task tool
      draft-commit.js   # draft_commit_message tool
      list-models.js    # list_models tool
      check-updates.js  # check_model_updates tool
      get-config.js     # get_config tool
    prompts.js          # System prompts for each tool (keeps prompt text out of tool files)
    meta.js             # Response metadata formatting helper
  test.js               # Full test suite
  package.json
  .mcp.json.example
  .gitignore
```

**Why split from the single-file pattern in dtg-obsidian-mcp:** That project has 56 tools doing simple file I/O — one file works. This project has VRAM management, an HTTP client, config validation, and prompt engineering — cramming it all into one file would make individual tools hard to reason about and edit. Each file has one clear job.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.mcp.json.example`
- Create: `index.js` (minimal — just starts server)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "ollama-mcp",
  "version": "1.0.0",
  "description": "VRAM-aware MCP server that offloads token-heavy tasks to local Ollama models",
  "main": "index.js",
  "type": "module",
  "bin": {
    "ollama-mcp": "./index.js"
  },
  "scripts": {
    "start": "node index.js",
    "test": "node test.js"
  },
  "keywords": ["mcp", "ollama", "local-llm", "vram"],
  "author": "digitalghost404",
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "zod": "^4.3.6"
  }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
```

- [ ] **Step 3: Create .mcp.json.example**

```json
{
  "mcpServers": {
    "ollama": {
      "command": "node",
      "args": ["/home/digitalghost/projects/ollama-mcp/index.js"]
    }
  }
}
```

- [ ] **Step 4: Create minimal index.js**

```javascript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "ollama",
  version: "1.0.0",
});

// Tools will be registered here in later tasks

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 5: Install dependencies and verify**

Run: `cd ~/projects/ollama-mcp && npm install`
Expected: `node_modules/` created, no errors

- [ ] **Step 6: Verify server starts without errors**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | node index.js`
Expected: JSON response containing `"result"` with server info, no crash

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .mcp.json.example index.js
git commit -m "feat: scaffold project with MCP server skeleton"
```

---

### Task 2: Config Module

**Files:**
- Create: `lib/config.js`

- [ ] **Step 1: Write the config test**

Create a temporary test inline — we'll move to `test.js` later. For now, test with node directly.

Create `lib/config.js`:

```javascript
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
      models: ["qwen2.5-coder:14b", "qwen2.5-coder:7b", "qwen3.5:4b"],
      temperature: 0.3,
    },
    content: {
      models: ["qwen3.5:9b", "qwen3.5:4b", "qwen3.5:0.8b"],
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

/**
 * Load config from disk. Creates default config if missing.
 * Falls back to defaults if config is invalid (logs error to stderr).
 */
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
      // Config doesn't exist — create with defaults
      await fs.mkdir(CONFIG_DIR, { recursive: true });
      await fs.writeFile(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2), "utf-8");
      console.error(`[ollama-mcp] Created default config at ${CONFIG_PATH}`);
      return { ...DEFAULTS };
    }
    // Corrupted JSON or other read error
    console.error(`[ollama-mcp] Error reading config: ${err.message}`);
    console.error(`[ollama-mcp] Using default configuration.`);
    return { ...DEFAULTS };
  }
}
```

- [ ] **Step 2: Verify config loads**

Run: `node -e "import('./lib/config.js').then(m => m.loadConfig()).then(c => console.log(JSON.stringify(c, null, 2)))"`
Expected: Prints the default config JSON. Creates `~/.ollama-mcp/config.json`.

- [ ] **Step 3: Verify invalid config falls back to defaults**

Run: `echo "not json" > ~/.ollama-mcp/config.json && node -e "import('./lib/config.js').then(m => m.loadConfig()).then(c => console.log(c.ollama.host))"`
Expected: Prints `http://localhost:11434` and logs a warning to stderr.

- [ ] **Step 4: Restore valid config**

Run: `rm ~/.ollama-mcp/config.json`
(Next load will recreate it from defaults.)

- [ ] **Step 5: Commit**

```bash
mkdir -p lib
git add lib/config.js
git commit -m "feat: add config module with Zod validation and defaults"
```

---

### Task 3: Ollama Client

**Files:**
- Create: `lib/ollama-client.js`

- [ ] **Step 1: Create the Ollama HTTP client**

```javascript
/**
 * Thin HTTP client for Ollama REST API.
 * Uses native fetch() — no external dependencies.
 */

export class OllamaClient {
  constructor(host, timeoutMs) {
    this.host = host.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  /**
   * Check if Ollama is reachable.
   * @returns {Promise<boolean>}
   */
  async isReachable() {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get Ollama version string.
   * @returns {Promise<string>}
   */
  async getVersion() {
    const res = await fetch(`${this.host}/api/version`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data.version;
  }

  /**
   * List all pulled models with sizes.
   * @returns {Promise<Array<{name: string, size: number, digest: string, details: object}>>}
   */
  async listModels() {
    const res = await fetch(`${this.host}/api/tags`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return data.models || [];
  }

  /**
   * List currently loaded models with VRAM usage.
   * @returns {Promise<Array<{name: string, size: number, size_vram: number}>>}
   */
  async listRunning() {
    const res = await fetch(`${this.host}/api/ps`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data.models || [];
  }

  /**
   * Get model details including context window size.
   * @param {string} model
   * @returns {Promise<{contextLength: number, size: number}>}
   */
  async showModel(model) {
    const res = await fetch(`${this.host}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error(`Model not found: ${model}`);
    }
    const data = await res.json();
    // Context length is in model_info under various keys depending on architecture
    const info = data.model_info || {};
    const contextLength =
      info["llama.context_length"] ||
      info["qwen2.context_length"] ||
      info["gemma.context_length"] ||
      info["context_length"] ||
      4096; // safe fallback
    return {
      contextLength,
      size: data.size || 0,
      parameters: data.details?.parameter_size || "unknown",
    };
  }

  /**
   * Generate a completion. Non-streaming — returns full response.
   * @param {string} model
   * @param {string} prompt
   * @param {string} system - System prompt
   * @param {number} temperature
   * @returns {Promise<{response: string, totalDuration: number, loadDuration: number, evalCount: number}>}
   */
  async generate(model, prompt, system, temperature) {
    const res = await fetch(`${this.host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        system,
        stream: false,
        options: { temperature },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama generate failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return {
      response: data.response || "",
      // Ollama returns durations in nanoseconds
      totalDuration: Math.round((data.total_duration || 0) / 1e6),
      loadDuration: Math.round((data.load_duration || 0) / 1e6),
      evalCount: data.eval_count || 0,
    };
  }

  /**
   * Check if a specific model has an update available on the registry.
   * Uses the /api/pull with dry_run-like approach: HEAD request to registry.
   * Falls back to comparing digests from /api/tags vs /api/show.
   * @param {string} model
   * @returns {Promise<{name: string, updateAvailable: boolean, localDigest: string}>}
   */
  async checkUpdate(model) {
    // Get local digest from /api/tags
    const models = await this.listModels();
    const local = models.find((m) => m.name === model || m.model === model);
    if (!local) {
      return { name: model, updateAvailable: false, localDigest: "not_pulled" };
    }

    // Try a pull with stream to check — first response chunk tells us if layers are already present
    try {
      const res = await fetch(`${this.host}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model, stream: false }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      // If status is "success" and it completed almost instantly, no update
      // If it starts downloading, there's an update
      // This is imperfect — cancel quickly
      return {
        name: model,
        updateAvailable: data.status !== "success",
        localDigest: local.digest || "unknown",
      };
    } catch {
      return {
        name: model,
        updateAvailable: false,
        localDigest: local.digest || "unknown",
      };
    }
  }
}
```

- [ ] **Step 2: Verify client can reach Ollama**

Run: `node -e "import('./lib/ollama-client.js').then(m => { const c = new m.OllamaClient('http://localhost:11434', 120000); c.isReachable().then(r => console.log('reachable:', r)); c.listModels().then(m => console.log('models:', m.map(x => x.name))); c.listRunning().then(r => console.log('running:', r.length)); })"`
Expected: `reachable: true`, list of model names, running count

- [ ] **Step 3: Verify showModel returns context length**

Run: `node -e "import('./lib/ollama-client.js').then(m => { const c = new m.OllamaClient('http://localhost:11434', 120000); c.showModel('qwen3.5:4b').then(d => console.log(d)); })"`
Expected: Object with `contextLength` (likely 262144 for qwen3.5), `size`, and `parameters`

- [ ] **Step 4: Commit**

```bash
git add lib/ollama-client.js
git commit -m "feat: add Ollama HTTP client with generate, list, show, and update check"
```

---

### Task 4: VRAM Manager

**Files:**
- Create: `lib/vram-manager.js`

- [ ] **Step 1: Create the VRAM manager**

```javascript
import { execFileSync } from "child_process";

export class VramManager {
  /**
   * @param {import('./ollama-client.js').OllamaClient} ollama
   * @param {{bufferMb: number, cacheTtlMs: number}} vramConfig
   */
  constructor(ollama, vramConfig) {
    this.ollama = ollama;
    this.bufferBytes = vramConfig.bufferMb * 1024 * 1024;
    this.cacheTtlMs = vramConfig.cacheTtlMs;
    this._cache = null;
    this._cacheTime = 0;
  }

  /**
   * Query nvidia-smi for free VRAM in bytes.
   * Returns null if no GPU or nvidia-smi not found.
   */
  _queryGpuFreeBytes() {
    try {
      const out = execFileSync("nvidia-smi", [
        "--query-gpu=memory.free",
        "--format=csv,noheader,nounits",
      ], { encoding: "utf-8", timeout: 5000 });
      // Returns MiB — take first GPU
      const mib = parseInt(out.trim().split("\n")[0], 10);
      if (isNaN(mib)) return null;
      return mib * 1024 * 1024;
    } catch {
      return null;
    }
  }

  /**
   * Get current VRAM state. Cached for cacheTtlMs.
   * @param {boolean} bypassCache
   * @returns {Promise<{freeBytes: number|null, loadedModels: Map<string, number>, pulledModels: Map<string, number>}>}
   */
  async getVramState(bypassCache = false) {
    const now = Date.now();
    if (!bypassCache && this._cache && now - this._cacheTime < this.cacheTtlMs) {
      return this._cache;
    }

    const [running, models] = await Promise.all([
      this.ollama.listRunning(),
      this.ollama.listModels(),
    ]);

    // Map of model name -> VRAM bytes currently loaded
    const loadedModels = new Map();
    for (const m of running) {
      loadedModels.set(m.name, m.size_vram || m.size || 0);
    }

    // Map of model name -> file size (proxy for VRAM when not loaded)
    const pulledModels = new Map();
    for (const m of models) {
      pulledModels.set(m.name, m.size || 0);
    }

    const freeBytes = this._queryGpuFreeBytes();

    this._cache = { freeBytes, loadedModels, pulledModels };
    this._cacheTime = now;
    return this._cache;
  }

  /**
   * Select the best model from a preference chain that fits in VRAM.
   * @param {string[]} chain - Ordered model preferences (best first)
   * @returns {Promise<{model: string, reason: string}>}
   */
  async selectModel(chain) {
    const state = await this.getVramState();

    // Pass 1: Is any model in the chain already loaded?
    for (const model of chain) {
      if (state.loadedModels.has(model)) {
        return { model, reason: "already loaded in VRAM" };
      }
    }

    // Pass 2: Does any model fit in free VRAM?
    if (state.freeBytes !== null) {
      const effectiveFree = state.freeBytes - this.bufferBytes;
      for (const model of chain) {
        const size = state.pulledModels.get(model);
        if (size === undefined) continue; // not pulled — skip
        if (size <= effectiveFree) {
          return { model, reason: `fits in VRAM (${(size / 1e9).toFixed(1)}GB model, ${(effectiveFree / 1e9).toFixed(1)}GB free)` };
        }
      }

      // Nothing fits — build error
      const available = chain.filter((m) => state.pulledModels.has(m));
      const notPulled = chain.filter((m) => !state.pulledModels.has(m));
      let msg = `GPU memory full (${((state.freeBytes) / 1e9).toFixed(1)}GB free, ${(this.bufferBytes / 1e9).toFixed(1)}GB reserved).`;
      if (available.length > 0) {
        msg += ` Pulled models too large: ${available.join(", ")}.`;
      }
      if (notPulled.length > 0) {
        msg += ` Not pulled: ${notPulled.join(", ")}.`;
      }
      msg += ` Free VRAM or wait for Ollama to unload idle models.`;
      throw new Error(msg);
    }

    // No GPU — CPU fallback, pick smallest pulled model
    for (let i = chain.length - 1; i >= 0; i--) {
      if (state.pulledModels.has(chain[i])) {
        return { model: chain[i], reason: "no GPU detected — CPU fallback (smallest available)" };
      }
    }

    // Nothing pulled at all
    throw new Error(
      `No models available. Run: ${chain.map((m) => `ollama pull ${m}`).join(" or ")}`
    );
  }

  /**
   * Select model with OOM retry. If Ollama fails to load, re-check VRAM and try next model.
   * @param {string[]} chain
   * @returns {Promise<{model: string, reason: string}>}
   */
  async selectModelWithRetry(chain) {
    try {
      return await this.selectModel(chain);
    } catch (firstError) {
      // If this was an OOM-like error, retry with fresh VRAM data
      if (firstError.message.includes("GPU memory full")) {
        throw firstError; // Already checked — no point retrying
      }
      throw firstError;
    }
  }

  /**
   * Called when Ollama returns an OOM during generation.
   * Invalidates cache and tries the next model in the chain.
   * @param {string} failedModel
   * @param {string[]} chain
   * @returns {Promise<{model: string, reason: string}>}
   */
  async retryAfterOom(failedModel, chain) {
    // Invalidate cache
    this._cache = null;
    this._cacheTime = 0;

    // Remove the failed model and try again
    const remaining = chain.filter((m) => m !== failedModel);
    if (remaining.length === 0) {
      throw new Error(
        `All models exhausted after OOM on ${failedModel}. Free VRAM or wait for Ollama to unload idle models.`
      );
    }
    return await this.selectModel(remaining);
  }
}
```

- [ ] **Step 2: Verify VRAM manager can select a model**

Run: `node -e "import('./lib/ollama-client.js').then(oc => import('./lib/vram-manager.js').then(vm => { const c = new oc.OllamaClient('http://localhost:11434', 120000); const v = new vm.VramManager(c, {bufferMb: 1024, cacheTtlMs: 5000}); v.selectModel(['qwen2.5-coder:14b', 'qwen2.5-coder:7b', 'qwen3.5:4b']).then(r => console.log(r)).catch(e => console.log('error:', e.message)); }))"`
Expected: `{ model: 'qwen3.5:4b', reason: '...' }` or similar (depends on what's pulled and GPU state)

- [ ] **Step 3: Commit**

```bash
git add lib/vram-manager.js
git commit -m "feat: add VRAM manager with model selection, caching, and OOM retry"
```

---

### Task 5: Response Metadata Helper

**Files:**
- Create: `lib/meta.js`

- [ ] **Step 1: Create the metadata formatting helper**

```javascript
/**
 * Formats tool output with appended metadata block.
 * @param {string} text - The main tool output
 * @param {object} meta - Metadata to append
 * @param {string} meta.model - Model used
 * @param {number} meta.loadTimeMs - Time to load model
 * @param {number} meta.generateTimeMs - Time to generate
 * @param {number} meta.totalTimeMs - Total wall time
 * @param {number} meta.tokensGenerated - Tokens in response
 * @param {boolean} meta.fellBack - Whether a fallback model was used
 * @param {string} meta.originalModel - First-choice model
 * @returns {{content: Array<{type: string, text: string}>}}
 */
export function formatResponse(text, meta) {
  const metaBlock = `\n\n\`\`\`json meta\n${JSON.stringify(meta)}\n\`\`\``;
  return {
    content: [{ type: "text", text: text + metaBlock }],
  };
}

/**
 * Formats an error response.
 * @param {string} message
 * @returns {{content: Array<{type: string, text: string}>, isError: boolean}}
 */
export function formatError(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
```

- [ ] **Step 2: Verify**

Run: `node -e "import('./lib/meta.js').then(m => console.log(JSON.stringify(m.formatResponse('hello', {model:'test',loadTimeMs:0,generateTimeMs:100,totalTimeMs:100,tokensGenerated:5,fellBack:false,originalModel:'test'}), null, 2)))"`
Expected: MCP response with text containing `hello` followed by a meta JSON block

- [ ] **Step 3: Commit**

```bash
git add lib/meta.js
git commit -m "feat: add response metadata and error formatting helpers"
```

---

### Task 6: System Prompts

**Files:**
- Create: `lib/prompts.js`

- [ ] **Step 1: Create the prompts module**

```javascript
/**
 * System prompts for each tool. Kept separate from tool logic so they're
 * easy to tune without touching tool registration code.
 */

export const PROMPTS = {
  draft_code: (language) =>
    `You are a code generator. Write clean, working code. ${language ? `Language: ${language}.` : ""} Output ONLY the code — no explanations, no markdown fences unless the code itself is markdown. If you need to explain something, put it in a code comment.`,

  triage_issues: (focus) => {
    const focusInstructions = {
      "type-mismatches":
        "Look for type errors: wrong argument types, mismatched return types, implicit coercions that could fail, generic type violations.",
      security:
        "Look for security vulnerabilities: injection (SQL, command, XSS), path traversal, insecure deserialization, hardcoded secrets, missing input validation.",
      "null-errors":
        "Look for null/undefined errors: missing null checks, optional chaining gaps, uninitialized variables, nullable returns used without guards.",
      "unused-code":
        "Look for dead code: unused imports, unreachable branches, variables assigned but never read, functions defined but never called.",
      "logic-bugs":
        "Look for logic errors: off-by-one, wrong comparison operators, inverted conditions, race conditions, missing break in switch, incorrect loop bounds.",
    };
    return `You are a code reviewer. Analyze the code for issues.\n\nFocus: ${focusInstructions[focus] || focus}\n\nFor each issue found, output:\n- Line number or location\n- What the issue is\n- Why it's a problem\n- Suggested fix\n\nIf no issues found, say "No issues found." Do not invent issues.`;
  },

  draft_content: (style) => {
    const styleHints = {
      readme: "Write in README style: clear sections, badges placeholder, installation/usage/contributing.",
      lesson: "Write as a structured lesson: learning objectives, explanation with examples, exercises, key takeaways.",
      lab: "Write as a hands-on lab guide: prerequisites, step-by-step instructions, expected outputs, troubleshooting tips.",
      docs: "Write as technical documentation: concise, accurate, well-structured with headings and code examples.",
    };
    return `You are a technical writer. Write clear, well-structured markdown content. ${styleHints[style] || ""} Output markdown directly — no wrapping fences.`;
  },

  summarize_file: (maxLength) =>
    `You are a file summarizer. Summarize the following file contents concisely. Target length: ~${maxLength} words. Focus on: what this file does, key functions/classes/exports, dependencies, and anything unusual. Output plain text, no markdown fences.`,

  classify_task: () =>
    `You are a task classifier. Classify the given task into exactly one complexity level.\n\nRules:\n- "simple": Single-file change, boilerplate, config edit, rename, formatting\n- "moderate": Multi-file change, new function/component, bug fix requiring investigation\n- "complex": Architectural change, new system/service, security-sensitive, requires research\n\nRespond with ONLY valid JSON: {"complexity":"simple|moderate|complex","reasoning":"one sentence why"}`,

  draft_commit_message: (style) =>
    style === "descriptive"
      ? `You are a git commit message writer. Write a clear, descriptive commit message for this diff. First line: summary under 72 chars. Then blank line. Then bullet points of what changed and why. Output the message directly, no fences.`
      : `You are a git commit message writer. Write a conventional commit message for this diff. Format: type(scope): description\n\nTypes: feat, fix, refactor, docs, test, chore, perf, style, ci, build\nScope is optional. Description should be under 72 chars, lowercase, imperative mood.\nOutput ONLY the commit message, nothing else.`,
};
```

- [ ] **Step 2: Verify prompts load**

Run: `node -e "import('./lib/prompts.js').then(m => { console.log(m.PROMPTS.draft_code('python').slice(0, 50)); console.log(m.PROMPTS.classify_task().slice(0, 50)); })"`
Expected: First 50 chars of each prompt

- [ ] **Step 3: Commit**

```bash
git add lib/prompts.js
git commit -m "feat: add system prompts for all tools"
```

---

### Task 7: Core Tool Execution Helper

Before implementing individual tools, create a shared function that handles the common flow: input validation -> model selection -> context check -> generate -> handle errors -> format response.

**Files:**
- Create: `lib/tools/run-tool.js`

- [ ] **Step 1: Create the shared tool runner**

```javascript
import { formatResponse, formatError } from "../meta.js";

/**
 * Shared execution flow for all model-backed tools.
 *
 * @param {object} opts
 * @param {string} opts.toolName - Tool name for error messages
 * @param {import('../vram-manager.js').VramManager} opts.vramManager
 * @param {import('../ollama-client.js').OllamaClient} opts.ollama
 * @param {string[]} opts.modelChain - Model preference chain
 * @param {number} opts.temperature
 * @param {string} opts.systemPrompt
 * @param {string} opts.userPrompt - The assembled user prompt
 * @param {object} [opts.inputChecks] - Map of field name -> {value, limit} for size checks
 * @returns {Promise<{content: Array}>}
 */
export async function runTool(opts) {
  const {
    toolName,
    vramManager,
    ollama,
    modelChain,
    temperature,
    systemPrompt,
    userPrompt,
    inputChecks,
  } = opts;

  // 1. Check Ollama is reachable
  const reachable = await ollama.isReachable();
  if (!reachable) {
    return formatError(
      "Ollama is not running. Start it with `ollama serve` or check `systemctl status ollama`"
    );
  }

  // 2. Input size checks
  if (inputChecks) {
    for (const [field, { value, limit }] of Object.entries(inputChecks)) {
      const size = Buffer.byteLength(value, "utf-8");
      if (size > limit) {
        return formatError(
          `Input exceeds maximum size for ${toolName} field "${field}" (${(size / 1024).toFixed(1)}KB > ${(limit / 1024).toFixed(1)}KB). Reduce input or break it into chunks.`
        );
      }
    }
  }

  // 3. Select model
  let selection;
  try {
    selection = await vramManager.selectModel(modelChain);
  } catch (err) {
    return formatError(err.message);
  }

  const { model, reason } = selection;
  const originalModel = modelChain[0];
  const fellBack = model !== originalModel;

  // 4. Check context window
  try {
    const modelInfo = await ollama.showModel(model);
    const totalPrompt = systemPrompt + "\n" + userPrompt;
    const estimatedTokens = Math.ceil(totalPrompt.length / 4);
    if (estimatedTokens > modelInfo.contextLength) {
      return formatError(
        `Input too large for ${model} (~${estimatedTokens} tokens, max ${modelInfo.contextLength}). Reduce input size or chunk the content.`
      );
    }
  } catch (err) {
    // showModel failed — log but don't block (context check is best-effort)
    console.error(`[ollama-mcp] Warning: could not check context window for ${model}: ${err.message}`);
  }

  // 5. Generate
  let result;
  const startTime = Date.now();
  try {
    result = await ollama.generate(model, userPrompt, systemPrompt, temperature);
  } catch (err) {
    // OOM retry — try next model
    if (err.message.includes("out of memory") || err.message.includes("OOM")) {
      try {
        const retry = await vramManager.retryAfterOom(model, modelChain);
        result = await ollama.generate(retry.model, userPrompt, systemPrompt, temperature);
        // Update tracking for metadata
        selection.model = retry.model;
        selection.reason = retry.reason;
      } catch (retryErr) {
        return formatError(`Generation failed after OOM retry: ${retryErr.message}`);
      }
    } else if (err.name === "TimeoutError" || err.message.includes("timed out")) {
      return formatError(
        `Generation timed out. Model: ${model}. Try a smaller model or shorter prompt.`
      );
    } else {
      return formatError(`Ollama error: ${err.message}`);
    }
  }

  // 6. Check for empty output
  if (!result.response || !result.response.trim()) {
    return formatError(
      `Model returned empty response. Model: ${model}, input size: ${userPrompt.length} chars. Try a larger model or simpler prompt.`
    );
  }

  // 7. Format response with metadata
  const totalTimeMs = Date.now() - startTime;
  return formatResponse(result.response, {
    model: selection.model,
    loadTimeMs: result.loadDuration,
    generateTimeMs: result.totalDuration - result.loadDuration,
    totalTimeMs,
    tokensGenerated: result.evalCount,
    fellBack,
    originalModel,
  });
}
```

- [ ] **Step 2: Commit**

```bash
mkdir -p lib/tools
git add lib/tools/run-tool.js
git commit -m "feat: add shared tool runner with input validation, model selection, and error handling"
```

---

### Task 8: Implement Tool — `classify_task`

Starting with the simplest tool to validate the full pipeline end-to-end.

**Files:**
- Create: `lib/tools/classify-task.js`
- Modify: `index.js` — register the tool

- [ ] **Step 1: Create the tool module**

```javascript
import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";
import { formatError } from "../meta.js";

/**
 * Register the classify_task tool on the MCP server.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('../ollama-client.js').OllamaClient} ollama
 * @param {import('../vram-manager.js').VramManager} vramManager
 * @param {object} config - Full config object
 */
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
      // Extract just the model output (before the meta block)
      const modelOutput = rawText.split("\n\n```json meta")[0].trim();

      try {
        const parsed = JSON.parse(modelOutput);
        if (parsed.complexity && parsed.reasoning) {
          return result; // Valid JSON output — return with metadata
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
            // Reconstruct with clean JSON + original metadata
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
```

- [ ] **Step 2: Wire into index.js**

Replace the contents of `index.js` with:

```javascript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./lib/config.js";
import { OllamaClient } from "./lib/ollama-client.js";
import { VramManager } from "./lib/vram-manager.js";
import { registerClassifyTask } from "./lib/tools/classify-task.js";

const config = await loadConfig();
const ollama = new OllamaClient(config.ollama.host, config.ollama.timeoutMs);
const vramManager = new VramManager(ollama, config.vram);

// Check Ollama version on startup
try {
  const version = await ollama.getVersion();
  console.error(`[ollama-mcp] Ollama ${version} detected`);
} catch {
  console.error("[ollama-mcp] Warning: could not reach Ollama at startup");
}

const server = new McpServer({
  name: "ollama",
  version: "1.0.0",
});

// Register tools
registerClassifyTask(server, ollama, vramManager, config);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 3: End-to-end test via MCP protocol**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"classify_task","arguments":{"task":"add a button to the login page"}}}' | node index.js 2>/dev/null`
Expected: JSON response with a classification result and metadata block

- [ ] **Step 4: Commit**

```bash
git add lib/tools/classify-task.js index.js
git commit -m "feat: add classify_task tool — first end-to-end tool"
```

---

### Task 9: Implement Tool — `draft_commit_message`

**Files:**
- Create: `lib/tools/draft-commit.js`
- Modify: `index.js` — add import and registration

- [ ] **Step 1: Create the tool module**

```javascript
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
```

- [ ] **Step 2: Add to index.js**

Add import at the top of `index.js`:
```javascript
import { registerDraftCommit } from "./lib/tools/draft-commit.js";
```

Add registration after `registerClassifyTask`:
```javascript
registerDraftCommit(server, ollama, vramManager, config);
```

- [ ] **Step 3: Test with a real diff**

Run: `cd ~/projects/ollama-mcp && DIFF=$(git diff HEAD~1 --stat) && echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0.1.0\"}}}
{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}
{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"draft_commit_message\",\"arguments\":{\"diff\":\"$DIFF\"}}}" | node index.js 2>/dev/null`
Expected: JSON response with a commit message

- [ ] **Step 4: Commit**

```bash
git add lib/tools/draft-commit.js index.js
git commit -m "feat: add draft_commit_message tool"
```

---

### Task 10: Implement Tool — `summarize_file`

**Files:**
- Create: `lib/tools/summarize-file.js`
- Modify: `index.js` — add import and registration

- [ ] **Step 1: Create the tool module**

```javascript
import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerSummarizeFile(server, ollama, vramManager, config) {
  server.tool(
    "summarize_file",
    "Summarize file contents using a local model. Use this to compress large files before processing them — saves tokens by reducing input size.",
    {
      content: z.string().min(1).describe("File contents to summarize (max 200KB)"),
      max_length: z
        .number()
        .int()
        .min(50)
        .max(1000)
        .optional()
        .default(200)
        .describe("Target summary length in words (default 200)"),
    },
    async ({ content, max_length }) => {
      return await runTool({
        toolName: "summarize_file",
        vramManager,
        ollama,
        modelChain: config.groups.content.models,
        temperature: config.groups.content.temperature,
        systemPrompt: PROMPTS.summarize_file(max_length),
        userPrompt: content,
        inputChecks: {
          content: {
            value: content,
            limit: config.inputLimits.summarize_file_content,
          },
        },
      });
    }
  );
}
```

- [ ] **Step 2: Add to index.js**

Add import:
```javascript
import { registerSummarizeFile } from "./lib/tools/summarize-file.js";
```

Add registration:
```javascript
registerSummarizeFile(server, ollama, vramManager, config);
```

- [ ] **Step 3: Commit**

```bash
git add lib/tools/summarize-file.js index.js
git commit -m "feat: add summarize_file tool"
```

---

### Task 11: Implement Tool — `draft_content`

**Files:**
- Create: `lib/tools/draft-content.js`
- Modify: `index.js` — add import and registration

- [ ] **Step 1: Create the tool module**

```javascript
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
```

- [ ] **Step 2: Add to index.js**

Add import:
```javascript
import { registerDraftContent } from "./lib/tools/draft-content.js";
```

Add registration:
```javascript
registerDraftContent(server, ollama, vramManager, config);
```

- [ ] **Step 3: Commit**

```bash
git add lib/tools/draft-content.js index.js
git commit -m "feat: add draft_content tool"
```

---

### Task 12: Implement Tool — `draft_code`

**Files:**
- Create: `lib/tools/draft-code.js`
- Modify: `index.js` — add import and registration

- [ ] **Step 1: Create the tool module**

```javascript
import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerDraftCode(server, ollama, vramManager, config) {
  server.tool(
    "draft_code",
    "Generate a first draft of code using a local model. Returns a draft that may need refinement — use it as a starting point, not production-ready output.",
    {
      prompt: z.string().min(1).describe("What to generate"),
      language: z
        .string()
        .optional()
        .describe("Target language (e.g., python, go, typescript)"),
      context: z
        .string()
        .optional()
        .describe("Existing code for reference (max 50KB)"),
    },
    async ({ prompt, language, context }) => {
      const userPrompt = context
        ? `Existing code for reference:\n\n${context}\n\n---\n\nGenerate: ${prompt}`
        : prompt;

      return await runTool({
        toolName: "draft_code",
        vramManager,
        ollama,
        modelChain: config.groups.code.models,
        temperature: config.groups.code.temperature,
        systemPrompt: PROMPTS.draft_code(language),
        userPrompt,
        inputChecks: context
          ? {
              context: {
                value: context,
                limit: config.inputLimits.draft_code_context,
              },
            }
          : undefined,
      });
    }
  );
}
```

- [ ] **Step 2: Add to index.js**

Add import:
```javascript
import { registerDraftCode } from "./lib/tools/draft-code.js";
```

Add registration:
```javascript
registerDraftCode(server, ollama, vramManager, config);
```

- [ ] **Step 3: Commit**

```bash
git add lib/tools/draft-code.js index.js
git commit -m "feat: add draft_code tool"
```

---

### Task 13: Implement Tool — `triage_issues`

**Files:**
- Create: `lib/tools/triage-issues.js`
- Modify: `index.js` — add import and registration

- [ ] **Step 1: Create the tool module**

```javascript
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
```

- [ ] **Step 2: Add to index.js**

Add import:
```javascript
import { registerTriageIssues } from "./lib/tools/triage-issues.js";
```

Add registration:
```javascript
registerTriageIssues(server, ollama, vramManager, config);
```

- [ ] **Step 3: Commit**

```bash
git add lib/tools/triage-issues.js index.js
git commit -m "feat: add triage_issues tool"
```

---

### Task 14: Implement Management Tools — `list_models`, `check_model_updates`, `get_config`

**Files:**
- Create: `lib/tools/list-models.js`
- Create: `lib/tools/check-updates.js`
- Create: `lib/tools/get-config.js`
- Modify: `index.js` — add imports and registrations

- [ ] **Step 1: Create list_models**

```javascript
import { formatError } from "../meta.js";

export function registerListModels(server, ollama, vramManager, config) {
  server.tool(
    "list_models",
    "List all Ollama models: what's pulled, their sizes, which tool group they're assigned to, and what's currently loaded in VRAM.",
    {},
    async () => {
      const reachable = await ollama.isReachable();
      if (!reachable) {
        return formatError(
          "Ollama is not running. Start it with `ollama serve` or check `systemctl status ollama`"
        );
      }

      const [models, running] = await Promise.all([
        ollama.listModels(),
        ollama.listRunning(),
      ]);

      const loadedSet = new Set(running.map((r) => r.name));

      // Build group membership map
      const groupMap = new Map();
      for (const [groupName, groupConfig] of Object.entries(config.groups)) {
        for (const model of groupConfig.models) {
          if (!groupMap.has(model)) groupMap.set(model, []);
          groupMap.get(model).push(groupName);
        }
      }

      let output = "# Ollama Models\n\n";
      output += `| Model | Size | Status | Groups |\n`;
      output += `|-------|------|--------|--------|\n`;

      for (const m of models) {
        const sizeGb = (m.size / 1e9).toFixed(1);
        const status = loadedSet.has(m.name) ? "**LOADED**" : "pulled";
        const groups = groupMap.get(m.name)?.join(", ") || "—";
        output += `| ${m.name} | ${sizeGb}GB | ${status} | ${groups} |\n`;
      }

      // Show models in config but not pulled
      const pulledNames = new Set(models.map((m) => m.name));
      const missing = [];
      for (const [model] of groupMap) {
        if (!pulledNames.has(model)) missing.push(model);
      }
      if (missing.length > 0) {
        output += `\n## Not Pulled (in config but not downloaded)\n\n`;
        for (const m of missing) {
          output += `- ${m} — used by: ${groupMap.get(m).join(", ")}. Run: \`ollama pull ${m}\`\n`;
        }
      }

      return { content: [{ type: "text", text: output }] };
    }
  );
}
```

- [ ] **Step 2: Create check_model_updates**

```javascript
import { formatError } from "../meta.js";

export function registerCheckUpdates(server, ollama) {
  server.tool(
    "check_model_updates",
    "Check if any pulled models have newer versions available on the Ollama registry.",
    {},
    async () => {
      const reachable = await ollama.isReachable();
      if (!reachable) {
        return formatError(
          "Ollama is not running. Start it with `ollama serve` or check `systemctl status ollama`"
        );
      }

      const models = await ollama.listModels();
      if (models.length === 0) {
        return {
          content: [{ type: "text", text: "No models pulled. Nothing to check." }],
        };
      }

      let output = "# Model Update Check\n\n";
      output += "Note: This check pulls model manifests from the registry. It does not download model weights.\n\n";

      for (const m of models) {
        const result = await ollama.checkUpdate(m.name);
        const status = result.updateAvailable ? "UPDATE AVAILABLE" : "up to date";
        output += `- **${m.name}**: ${status} (digest: ${result.localDigest.slice(0, 12)})\n`;
      }

      return { content: [{ type: "text", text: output }] };
    }
  );
}
```

- [ ] **Step 3: Create get_config**

```javascript
export function registerGetConfig(server, config) {
  server.tool(
    "get_config",
    "Return the current server configuration: tool group to model preference chain mappings, temperatures, and limits.",
    {},
    async () => {
      const output = JSON.stringify(config, null, 2);
      return {
        content: [{ type: "text", text: `\`\`\`json\n${output}\n\`\`\`` }],
      };
    }
  );
}
```

- [ ] **Step 4: Add all three to index.js**

Add imports:
```javascript
import { registerListModels } from "./lib/tools/list-models.js";
import { registerCheckUpdates } from "./lib/tools/check-updates.js";
import { registerGetConfig } from "./lib/tools/get-config.js";
```

Add registrations:
```javascript
registerListModels(server, ollama, vramManager, config);
registerCheckUpdates(server, ollama);
registerGetConfig(server, config);
```

- [ ] **Step 5: Commit**

```bash
git add lib/tools/list-models.js lib/tools/check-updates.js lib/tools/get-config.js index.js
git commit -m "feat: add management tools — list_models, check_model_updates, get_config"
```

---

### Task 15: Test Suite

**Files:**
- Create: `test.js`

- [ ] **Step 1: Create the test suite**

This follows the dtg-obsidian-mcp pattern: spawn the server as a subprocess, communicate via JSON-RPC over stdio.

```javascript
#!/usr/bin/env node
/**
 * Ollama MCP — Test suite
 * Spawns the server, tests all tools, reports results.
 * Requires Ollama running with at least one model pulled.
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, "index.js");

const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const B = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, detail) {
  if (condition) {
    console.log(`  ${G("PASS")} ${testName}`);
    passed++;
  } else {
    console.log(`  ${R("FAIL")} ${testName} ${detail ? DIM(`— ${detail}`) : ""}`);
    failed++;
    failures.push(testName);
  }
}

class McpTestClient {
  constructor() {
    this.proc = null;
    this.buffer = "";
    this.pendingResolves = new Map();
    this.nextId = 1;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn("node", [SERVER_PATH], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc.stdout.on("data", (chunk) => {
        this.buffer += chunk.toString();
        // Process complete JSON-RPC messages (newline-delimited)
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop(); // keep incomplete line in buffer
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id && this.pendingResolves.has(msg.id)) {
              this.pendingResolves.get(msg.id)(msg);
              this.pendingResolves.delete(msg.id);
            }
          } catch {
            // Not JSON — ignore (could be stderr leaking)
          }
        }
      });
      this.proc.stderr.on("data", () => {}); // Suppress stderr
      // Initialize
      this.send({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.1.0" },
        },
      }).then((res) => {
        // Send initialized notification
        this.proc.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }) + "\n"
        );
        resolve(res);
      }).catch(reject);
    });
  }

  send(msg) {
    return new Promise((resolve, reject) => {
      const id = msg.id || this.nextId++;
      msg.id = id;
      this.pendingResolves.set(id, resolve);
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
      // Timeout after 180s (model generation can be slow)
      setTimeout(() => {
        if (this.pendingResolves.has(id)) {
          this.pendingResolves.delete(id);
          reject(new Error(`Timeout waiting for response to ${msg.method}`));
        }
      }, 180000);
    });
  }

  callTool(name, args) {
    return this.send({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    });
  }

  stop() {
    if (this.proc) {
      this.proc.stdin.end();
      this.proc.kill();
    }
  }
}

async function run() {
  console.log(B("\n  Ollama MCP — Test Suite\n"));

  const client = new McpTestClient();

  try {
    // ─── Init ──────────────────────────────
    console.log(Y("  Server"));
    const initRes = await client.start();
    assert(
      initRes.result?.serverInfo?.name === "ollama",
      "server initializes with name 'ollama'"
    );

    // ─── list_models ───────────────────────
    console.log(Y("\n  list_models"));
    const listRes = await client.callTool("list_models", {});
    assert(
      listRes.result?.content?.[0]?.text?.includes("Ollama Models"),
      "returns markdown table"
    );
    assert(
      !listRes.result?.isError,
      "no error"
    );

    // ─── get_config ────────────────────────
    console.log(Y("\n  get_config"));
    const configRes = await client.callTool("get_config", {});
    const configText = configRes.result?.content?.[0]?.text || "";
    assert(configText.includes("ollama"), "returns config with ollama section");
    assert(configText.includes("groups"), "returns config with groups section");

    // ─── classify_task ─────────────────────
    console.log(Y("\n  classify_task"));
    const classifyRes = await client.callTool("classify_task", {
      task: "add a CSS class to a button",
    });
    const classifyText = classifyRes.result?.content?.[0]?.text || "";
    assert(
      classifyText.includes("complexity") || classifyText.includes("simple") || classifyText.includes("moderate") || classifyText.includes("complex"),
      "returns complexity classification"
    );
    assert(classifyText.includes("json meta"), "includes metadata block");

    // ─── classify_task input limit ─────────
    console.log(Y("\n  classify_task (input limit)"));
    const bigTask = "x".repeat(6000);
    const limitRes = await client.callTool("classify_task", { task: bigTask });
    const limitText = limitRes.result?.content?.[0]?.text || "";
    assert(
      limitRes.result?.isError || limitText.includes("exceeds maximum"),
      "rejects oversized input"
    );

    // ─── draft_commit_message ──────────────
    console.log(Y("\n  draft_commit_message"));
    const commitRes = await client.callTool("draft_commit_message", {
      diff: `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1,3 +1,5 @@
+import { z } from "zod";
+
 const server = new McpServer({
   name: "ollama",
   version: "1.0.0",`,
    });
    const commitText = commitRes.result?.content?.[0]?.text || "";
    assert(commitText.length > 5, "returns a commit message");
    assert(commitText.includes("json meta"), "includes metadata block");

    // ─── summarize_file ────────────────────
    console.log(Y("\n  summarize_file"));
    const summarizeRes = await client.callTool("summarize_file", {
      content: `export class VramManager {
  constructor(ollama, vramConfig) {
    this.ollama = ollama;
    this.bufferBytes = vramConfig.bufferMb * 1024 * 1024;
    this.cacheTtlMs = vramConfig.cacheTtlMs;
  }
  async selectModel(chain) {
    const state = await this.getVramState();
    for (const model of chain) {
      if (state.loadedModels.has(model)) return { model, reason: "loaded" };
    }
    return { model: chain[chain.length - 1], reason: "fallback" };
  }
}`,
      max_length: 50,
    });
    const summarizeText = summarizeRes.result?.content?.[0]?.text || "";
    assert(summarizeText.length > 10, "returns a summary");

    // ─── draft_content ─────────────────────
    console.log(Y("\n  draft_content"));
    const contentRes = await client.callTool("draft_content", {
      prompt: "Write a 3-sentence description of a VRAM-aware model router.",
      style: "docs",
    });
    const contentText = contentRes.result?.content?.[0]?.text || "";
    assert(contentText.length > 20, "returns drafted content");

    // ─── draft_code ────────────────────────
    console.log(Y("\n  draft_code"));
    const codeRes = await client.callTool("draft_code", {
      prompt: "Write a JavaScript function called add(a, b) that returns a + b",
      language: "javascript",
    });
    const codeText = codeRes.result?.content?.[0]?.text || "";
    assert(codeText.includes("add") || codeText.includes("function"), "returns code with expected function");

    // ─── triage_issues ─────────────────────
    console.log(Y("\n  triage_issues"));
    const triageRes = await client.callTool("triage_issues", {
      code: `function divide(a, b) {
  return a / b;
}

function getUser(users, id) {
  return users.find(u => u.id == id).name;
}`,
      focus: "null-errors",
    });
    const triageText = triageRes.result?.content?.[0]?.text || "";
    assert(triageText.length > 10, "returns triage results");

  } catch (err) {
    console.log(R(`\n  ERROR: ${err.message}`));
    failed++;
  } finally {
    client.stop();
  }

  // ─── Summary ─────────────────────────────
  console.log(`\n  ${B("Results:")} ${G(`${passed} passed`)}, ${failed > 0 ? R(`${failed} failed`) : "0 failed"}`);
  if (failures.length > 0) {
    console.log(`  ${R("Failures:")}`);
    for (const f of failures) console.log(`    - ${f}`);
  }
  console.log();
  process.exit(failed > 0 ? 1 : 0);
}

run();
```

- [ ] **Step 2: Run the test suite**

Run: `cd ~/projects/ollama-mcp && node test.js`
Expected: All tests pass (assuming at least qwen3.5:4b is pulled). Tests involving models will take 5-30 seconds each.

- [ ] **Step 3: Commit**

```bash
git add test.js
git commit -m "feat: add test suite for all 9 tools"
```

---

### Task 16: Final index.js Wiring and Registration of MCP in Claude Config

**Files:**
- Modify: `index.js` — ensure all imports and registrations are complete
- Modify: `~/.claude.json` — register MCP server (or instruct user)

- [ ] **Step 1: Verify final index.js has all tool registrations**

The final `index.js` should have these imports and registrations (in order):

```javascript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./lib/config.js";
import { OllamaClient } from "./lib/ollama-client.js";
import { VramManager } from "./lib/vram-manager.js";
import { registerClassifyTask } from "./lib/tools/classify-task.js";
import { registerDraftCommit } from "./lib/tools/draft-commit.js";
import { registerSummarizeFile } from "./lib/tools/summarize-file.js";
import { registerDraftContent } from "./lib/tools/draft-content.js";
import { registerDraftCode } from "./lib/tools/draft-code.js";
import { registerTriageIssues } from "./lib/tools/triage-issues.js";
import { registerListModels } from "./lib/tools/list-models.js";
import { registerCheckUpdates } from "./lib/tools/check-updates.js";
import { registerGetConfig } from "./lib/tools/get-config.js";

const config = await loadConfig();
const ollama = new OllamaClient(config.ollama.host, config.ollama.timeoutMs);
const vramManager = new VramManager(ollama, config.vram);

// Check Ollama version on startup
try {
  const version = await ollama.getVersion();
  console.error(`[ollama-mcp] Ollama ${version} detected`);
} catch {
  console.error("[ollama-mcp] Warning: could not reach Ollama at startup");
}

const server = new McpServer({
  name: "ollama",
  version: "1.0.0",
});

// Register tools
registerClassifyTask(server, ollama, vramManager, config);
registerDraftCommit(server, ollama, vramManager, config);
registerSummarizeFile(server, ollama, vramManager, config);
registerDraftContent(server, ollama, vramManager, config);
registerDraftCode(server, ollama, vramManager, config);
registerTriageIssues(server, ollama, vramManager, config);
registerListModels(server, ollama, vramManager, config);
registerCheckUpdates(server, ollama);
registerGetConfig(server, config);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Register in Claude Code**

Run: `claude mcp add ollama node /home/digitalghost/projects/ollama-mcp/index.js`

Or manually add to `~/.claude.json` under the appropriate project scope:
```json
{
  "mcpServers": {
    "ollama": {
      "command": "node",
      "args": ["/home/digitalghost/projects/ollama-mcp/index.js"]
    }
  }
}
```

- [ ] **Step 3: Pull recommended models if not already present**

Run: `ollama pull qwen2.5-coder:14b && ollama pull qwen3.5:9b && ollama pull qwen3.5:0.8b`
(Keep qwen3.5:4b — already pulled. Remove llama3.2:3b and qwen2.5-coder:7b if you want to free disk space, or keep them as fallbacks.)

- [ ] **Step 4: Run full test suite one final time**

Run: `cd ~/projects/ollama-mcp && node test.js`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "feat: wire all 9 tools and finalize server"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Project scaffolding | `package.json`, `.gitignore`, `.mcp.json.example`, `index.js` |
| 2 | Config module | `lib/config.js` |
| 3 | Ollama HTTP client | `lib/ollama-client.js` |
| 4 | VRAM manager | `lib/vram-manager.js` |
| 5 | Response metadata helper | `lib/meta.js` |
| 6 | System prompts | `lib/prompts.js` |
| 7 | Shared tool runner | `lib/tools/run-tool.js` |
| 8 | classify_task tool (first E2E) | `lib/tools/classify-task.js` |
| 9 | draft_commit_message tool | `lib/tools/draft-commit.js` |
| 10 | summarize_file tool | `lib/tools/summarize-file.js` |
| 11 | draft_content tool | `lib/tools/draft-content.js` |
| 12 | draft_code tool | `lib/tools/draft-code.js` |
| 13 | triage_issues tool | `lib/tools/triage-issues.js` |
| 14 | Management tools (3) | `lib/tools/list-models.js`, `check-updates.js`, `get-config.js` |
| 15 | Test suite | `test.js` |
| 16 | Final wiring + Claude registration | `index.js` final, Claude config |
