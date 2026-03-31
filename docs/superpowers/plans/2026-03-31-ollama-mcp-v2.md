# Ollama MCP v2: Maximum Offload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 new tools, hot-reload config, and enhanced prompts to capture ~35-40% of Claude token waste identified in the session analysis — covering batch content, README generation, code explanation, review drafting, refactoring, changelog generation, and config hot-reload.

**Architecture:** Each new tool follows the existing pattern — a `lib/tools/<name>.js` file that exports a `register<Name>` function, calls `runTool()` for VRAM-aware model selection, and gets wired into `index.js`. Config hot-reload adds a `reload_config` tool that re-reads `~/.ollama-mcp/config.json` and swaps the live config object. New prompts are added to `lib/prompts.js`.

**Tech Stack:** Node.js, @modelcontextprotocol/sdk, zod, Ollama REST API

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `lib/tools/explain-code.js` | Targeted code explanation tool |
| Create | `lib/tools/generate-readme.js` | Project-aware README generator |
| Create | `lib/tools/review-code.js` | First-pass code review drafting |
| Create | `lib/tools/batch-content.js` | Template-based batch content generation |
| Create | `lib/tools/refactor-code.js` | Simple mechanical refactoring |
| Create | `lib/tools/generate-changelog.js` | Changelog from git log |
| Create | `lib/tools/reload-config.js` | Hot-reload config without restart |
| Modify | `lib/prompts.js` | Add 6 new system prompts |
| Modify | `lib/config.js` | Add new input limits, export mutable config loader |
| Modify | `index.js` | Register 7 new tools, support config reload |
| Modify | `test.js` | Add tests for all 7 new tools |

---

### Task 1: Hot-Reload Config

The foundation — every other task benefits from being able to reload config without restarting.

**Files:**
- Create: `lib/tools/reload-config.js`
- Modify: `index.js`
- Modify: `lib/config.js`
- Modify: `test.js`

- [ ] **Step 1: Write the failing test**

Add to `test.js` before the cleanup section:

```javascript
// ── reload_config ────────────────────────────────────────────────────────────
console.log(Y("\nreload_config"));
try {
  const res = await client.tool("reload_config");
  const text = getText(res);
  assert(
    !isError(res) && text.includes("reloaded"),
    "reload_config: returns confirmation with 'reloaded'",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "reload_config: returns confirmation with 'reloaded'", e.message);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: FAIL — `reload_config` tool not registered

- [ ] **Step 3: Make config mutable**

In `lib/config.js`, add a `reloadConfig` function that re-reads and validates the config file, returning the new config object:

```javascript
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
```

- [ ] **Step 4: Create the reload tool**

Create `lib/tools/reload-config.js`:

```javascript
import { formatError } from "../meta.js";
import { reloadConfig } from "../config.js";

export function registerReloadConfig(server, config) {
  server.tool(
    "reload_config",
    "Hot-reload the server configuration from ~/.ollama-mcp/config.json without restarting. Use after editing config.",
    {},
    async () => {
      const result = await reloadConfig(config);
      if (!result.ok) {
        return formatError(`Config reload failed: ${result.error}`);
      }
      const summary = Object.entries(config.groups)
        .map(([name, g]) => `${name}: [${g.models.join(", ")}]`)
        .join("\n");
      return {
        content: [{
          type: "text",
          text: `Configuration reloaded successfully.\n\nGroups:\n${summary}`,
        }],
      };
    }
  );
}
```

- [ ] **Step 5: Wire into index.js**

Add import and registration in `index.js`:

```javascript
import { registerReloadConfig } from "./lib/tools/reload-config.js";
// ... after other registrations:
registerReloadConfig(server, config);
```

- [ ] **Step 6: Run tests**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: All tests PASS including reload_config

- [ ] **Step 7: Commit**

```bash
cd /home/digitalghost/projects/ollama-mcp
git add lib/tools/reload-config.js lib/config.js index.js test.js
git commit -m "feat: add reload_config tool for hot-reloading config without restart"
```

---

### Task 2: Explain Code Tool

Targeted code explanation — different from `summarize_file` (which compresses). This explains *what the code does and why*, useful for exploring unfamiliar codebases without burning Claude tokens.

**Files:**
- Create: `lib/tools/explain-code.js`
- Modify: `lib/prompts.js`
- Modify: `lib/config.js` (add input limit)
- Modify: `index.js`
- Modify: `test.js`

- [ ] **Step 1: Write the failing test**

Add to `test.js`:

```javascript
// ── explain_code ─────────────────────────────────────────────────────────────
console.log(Y("\nexplain_code"));
const codeToExplain = `export class VramManager {
  constructor(ollama, vramConfig) {
    this.ollama = ollama;
    this.bufferBytes = vramConfig.bufferMb * 1024 * 1024;
    this.cacheTtlMs = vramConfig.cacheTtlMs;
    this._cache = null;
    this._cacheTime = 0;
  }
}`;
try {
  const res = await client.tool("explain_code", { code: codeToExplain });
  const text = getText(res);
  assert(
    !isError(res) && text.trim().length > 50,
    "explain_code: returns a substantive explanation",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "explain_code: returns a substantive explanation", e.message);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: FAIL — `explain_code` not registered

- [ ] **Step 3: Add prompt to prompts.js**

Add to the `PROMPTS` object in `lib/prompts.js`:

```javascript
  explain_code: (detail) =>
    `You are a code explainer. Explain what the given code does, how it works, and why it's structured this way. ${detail === "brief" ? "Keep it to 2-3 sentences." : "Be thorough: cover the purpose, key logic, data flow, and any non-obvious design choices."} Write in plain English, not code. Target audience: a developer new to this codebase.`,
```

- [ ] **Step 4: Add input limit to config.js**

In `lib/config.js`, add to the `inputLimits` in both the schema and DEFAULTS:

Schema addition in `ConfigSchema`:
```javascript
    explain_code_code: z.number().int().positive(),
```

DEFAULTS addition:
```javascript
    explain_code_code: 102400,
```

- [ ] **Step 5: Create the tool**

Create `lib/tools/explain-code.js`:

```javascript
import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerExplainCode(server, ollama, vramManager, config) {
  server.tool(
    "explain_code",
    "Explain what code does using a local model. Use for exploring unfamiliar codebases — cheaper than Claude for 'what does this do?' questions.",
    {
      code: z.string().min(1).describe("Code to explain (max 100KB)"),
      detail: z
        .enum(["brief", "thorough"])
        .optional()
        .default("thorough")
        .describe("Level of detail"),
      question: z
        .string()
        .optional()
        .describe("Specific question about the code (e.g., 'why does it cache here?')"),
    },
    async ({ code, detail, question }) => {
      const userPrompt = question
        ? `Code:\n\n${code}\n\n---\n\nSpecific question: ${question}`
        : code;

      return await runTool({
        toolName: "explain_code",
        vramManager,
        ollama,
        modelChain: config.groups.code.models,
        temperature: config.groups.code.temperature,
        systemPrompt: PROMPTS.explain_code(detail),
        userPrompt,
        inputChecks: {
          code: { value: code, limit: config.inputLimits.explain_code_code },
        },
      });
    }
  );
}
```

- [ ] **Step 6: Wire into index.js**

```javascript
import { registerExplainCode } from "./lib/tools/explain-code.js";
// ... after other registrations:
registerExplainCode(server, ollama, vramManager, config);
```

- [ ] **Step 7: Run tests**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
cd /home/digitalghost/projects/ollama-mcp
git add lib/tools/explain-code.js lib/prompts.js lib/config.js index.js test.js
git commit -m "feat: add explain_code tool for local code exploration"
```

---

### Task 3: Generate README Tool

Project-aware README generation. Reads project metadata (package.json, go.mod, pyproject.toml, Cargo.toml) and source structure to generate a README. Covers the 11% of commits that were documentation.

**Files:**
- Create: `lib/tools/generate-readme.js`
- Modify: `lib/prompts.js`
- Modify: `index.js`
- Modify: `test.js`

- [ ] **Step 1: Write the failing test**

Add to `test.js`:

```javascript
// ── generate_readme ──────────────────────────────────────────────────────────
console.log(Y("\ngenerate_readme"));
const projectInfo = `Project: my-cli-tool
package.json: {"name":"my-cli-tool","version":"1.0.0","description":"A CLI for managing tasks","scripts":{"start":"node index.js","test":"node test.js"},"dependencies":{"commander":"^12.0.0"}}
Directory tree:
src/
  index.js
  commands/
    add.js
    list.js
    remove.js
  utils/
    storage.js
test/
  commands.test.js`;
try {
  const res = await client.tool("generate_readme", { project_info: projectInfo });
  const text = getText(res);
  const hasTitle = text.includes("#");
  const hasInstall = text.toLowerCase().includes("install");
  assert(
    !isError(res) && hasTitle && hasInstall,
    "generate_readme: returns markdown with title and install section",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "generate_readme: returns markdown with title and install section", e.message);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: FAIL — `generate_readme` not registered

- [ ] **Step 3: Add prompt to prompts.js**

```javascript
  generate_readme: () =>
    `You are a README generator. Given a project's metadata and directory structure, write a complete README.md. Include: project title and description, installation, usage, project structure overview, available scripts/commands, dependencies, and license placeholder. Output markdown directly — no wrapping fences. Make it concise but complete.`,
```

- [ ] **Step 4: Create the tool**

Create `lib/tools/generate-readme.js`:

```javascript
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
```

- [ ] **Step 5: Wire into index.js**

```javascript
import { registerGenerateReadme } from "./lib/tools/generate-readme.js";
// ... after other registrations:
registerGenerateReadme(server, ollama, vramManager, config);
```

- [ ] **Step 6: Run tests**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd /home/digitalghost/projects/ollama-mcp
git add lib/tools/generate-readme.js lib/prompts.js index.js test.js
git commit -m "feat: add generate_readme tool for project-aware README generation"
```

---

### Task 4: Review Code Tool

First-pass code review — local model surfaces potential issues that Claude can then verify. Covers the pattern where Claude was doing full code reviews that a local model could pre-filter.

**Files:**
- Create: `lib/tools/review-code.js`
- Modify: `lib/prompts.js`
- Modify: `lib/config.js` (add input limit)
- Modify: `index.js`
- Modify: `test.js`

- [ ] **Step 1: Write the failing test**

Add to `test.js`:

```javascript
// ── review_code ──────────────────────────────────────────────────────────────
console.log(Y("\nreview_code"));
const codeToReview = `function processUsers(users) {
  let result = [];
  for (let i = 0; i <= users.length; i++) {
    const user = users[i];
    result.push(user.name.toUpperCase());
  }
  return result;
}`;
try {
  const res = await client.tool("review_code", { code: codeToReview });
  const text = getText(res);
  assert(
    !isError(res) && text.trim().length > 50,
    "review_code: returns substantive review feedback",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "review_code: returns substantive review feedback", e.message);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: FAIL

- [ ] **Step 3: Add prompt to prompts.js**

```javascript
  review_code: () =>
    `You are a code reviewer. Review the given code and provide actionable feedback. For each issue found:\n1. Location (line or section)\n2. What the issue is\n3. Severity (critical/warning/suggestion)\n4. Suggested fix with code\n\nFocus on: correctness bugs, off-by-one errors, null safety, error handling gaps, performance issues, and readability. Do NOT comment on style preferences (naming conventions, formatting). If the code is solid, say so briefly. Do not invent issues.`,
```

- [ ] **Step 4: Add input limit**

In `lib/config.js`, add to schema and DEFAULTS:

Schema: `review_code_code: z.number().int().positive(),`
Default: `review_code_code: 102400,`

- [ ] **Step 5: Create the tool**

Create `lib/tools/review-code.js`:

```javascript
import { z } from "zod";
import { PROMPTS } from "../prompts.js";
import { runTool } from "./run-tool.js";

export function registerReviewCode(server, ollama, vramManager, config) {
  server.tool(
    "review_code",
    "First-pass code review using a local model. Surfaces bugs, correctness issues, and improvement opportunities. Use as a pre-filter before Claude reviews.",
    {
      code: z.string().min(1).describe("Code to review (max 100KB)"),
      context: z
        .string()
        .optional()
        .describe("What this code does or what changed (helps focus the review)"),
    },
    async ({ code, context }) => {
      const userPrompt = context
        ? `Context: ${context}\n\n---\n\nCode to review:\n\n${code}`
        : code;

      return await runTool({
        toolName: "review_code",
        vramManager,
        ollama,
        modelChain: config.groups.code.models,
        temperature: config.groups.code.temperature,
        systemPrompt: PROMPTS.review_code(),
        userPrompt,
        inputChecks: {
          code: { value: code, limit: config.inputLimits.review_code_code },
        },
      });
    }
  );
}
```

- [ ] **Step 6: Wire into index.js**

```javascript
import { registerReviewCode } from "./lib/tools/review-code.js";
// ... after other registrations:
registerReviewCode(server, ollama, vramManager, config);
```

- [ ] **Step 7: Run tests**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
cd /home/digitalghost/projects/ollama-mcp
git add lib/tools/review-code.js lib/prompts.js lib/config.js index.js test.js
git commit -m "feat: add review_code tool for local first-pass code review"
```

---

### Task 5: Refactor Code Tool

Mechanical refactoring — renames, extracting functions, adding types, reformatting. The 4% of commits that were simple refactors.

**Files:**
- Create: `lib/tools/refactor-code.js`
- Modify: `lib/prompts.js`
- Modify: `lib/config.js` (add input limit)
- Modify: `index.js`
- Modify: `test.js`

- [ ] **Step 1: Write the failing test**

Add to `test.js`:

```javascript
// ── refactor_code ────────────────────────────────────────────────────────────
console.log(Y("\nrefactor_code"));
const codeToRefactor = `function calc(a,b,c) {
  const x = a * b;
  const y = x + c;
  const z = y / 2;
  return z;
}`;
try {
  const res = await client.tool("refactor_code", {
    code: codeToRefactor,
    instruction: "Rename variables to be descriptive and add JSDoc",
  });
  const text = getText(res);
  assert(
    !isError(res) && text.trim().length > 20,
    "refactor_code: returns refactored code",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "refactor_code: returns refactored code", e.message);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: FAIL

- [ ] **Step 3: Add prompt to prompts.js**

```javascript
  refactor_code: () =>
    `You are a code refactoring assistant. Apply the requested refactoring to the given code. Output ONLY the refactored code — no explanations, no markdown fences unless the code itself is markdown. Preserve all existing functionality. Do not add features, change behavior, or fix bugs unless specifically asked.`,
```

- [ ] **Step 4: Add input limit**

In `lib/config.js`, add to schema and DEFAULTS:

Schema: `refactor_code_code: z.number().int().positive(),`
Default: `refactor_code_code: 102400,`

- [ ] **Step 5: Create the tool**

Create `lib/tools/refactor-code.js`:

```javascript
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
```

- [ ] **Step 6: Wire into index.js**

```javascript
import { registerRefactorCode } from "./lib/tools/refactor-code.js";
// ... after other registrations:
registerRefactorCode(server, ollama, vramManager, config);
```

- [ ] **Step 7: Run tests**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
cd /home/digitalghost/projects/ollama-mcp
git add lib/tools/refactor-code.js lib/prompts.js lib/config.js index.js test.js
git commit -m "feat: add refactor_code tool for mechanical code refactoring"
```

---

### Task 6: Generate Changelog Tool

Generates changelogs from git commit messages. Covers the documentation gap where Claude was composing release notes.

**Files:**
- Create: `lib/tools/generate-changelog.js`
- Modify: `lib/prompts.js`
- Modify: `index.js`
- Modify: `test.js`

- [ ] **Step 1: Write the failing test**

Add to `test.js`:

```javascript
// ── generate_changelog ───────────────────────────────────────────────────────
console.log(Y("\ngenerate_changelog"));
const commitLog = `feat: add user authentication with JWT
fix: resolve race condition in session cleanup
docs: update API reference for /auth endpoints
refactor: extract token validation into middleware
feat: add password reset flow
fix: handle expired tokens gracefully
chore: bump jsonwebtoken to 9.0.2`;
try {
  const res = await client.tool("generate_changelog", { commits: commitLog });
  const text = getText(res);
  const hasSection = text.includes("##") || text.toLowerCase().includes("feature") || text.toLowerCase().includes("fix");
  assert(
    !isError(res) && hasSection,
    "generate_changelog: returns grouped changelog",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "generate_changelog: returns grouped changelog", e.message);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: FAIL

- [ ] **Step 3: Add prompt to prompts.js**

```javascript
  generate_changelog: (version) =>
    `You are a changelog writer. Given a list of git commit messages, produce a well-organized changelog.${version ? ` Version: ${version}.` : ""} Group entries by type: Features, Bug Fixes, Documentation, Refactoring, Other. Use markdown with ## headings for each group. Write each entry as a concise, user-facing bullet point — rephrase commit messages to be readable by end users. Skip merge commits and chore commits unless significant. Output markdown directly.`,
```

- [ ] **Step 4: Create the tool**

Create `lib/tools/generate-changelog.js`:

```javascript
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
```

- [ ] **Step 5: Wire into index.js**

```javascript
import { registerGenerateChangelog } from "./lib/tools/generate-changelog.js";
// ... after other registrations:
registerGenerateChangelog(server, ollama, vramManager, config);
```

- [ ] **Step 6: Run tests**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd /home/digitalghost/projects/ollama-mcp
git add lib/tools/generate-changelog.js lib/prompts.js index.js test.js
git commit -m "feat: add generate_changelog tool for changelog from git log"
```

---

### Task 7: Batch Content Tool

The biggest single token saver — generates multiple files from a template + variations list. Covers the xdc-learn-python pattern (100+ templated MDX files) and batch README generation.

**Files:**
- Create: `lib/tools/batch-content.js`
- Modify: `lib/prompts.js`
- Modify: `lib/config.js` (add input limit)
- Modify: `index.js`
- Modify: `test.js`

- [ ] **Step 1: Write the failing test**

Add to `test.js`:

```javascript
// ── batch_content ────────────────────────────────────────────────────────────
console.log(Y("\nbatch_content"));
const template = `# {{title}}

## Overview
A lesson about {{topic}}.

## Learning Objectives
- Understand {{topic}} fundamentals
- Apply {{topic}} in practice

## Content
Write a concise lesson about {{topic}} for {{audience}}.`;

const variations = JSON.stringify([
  { title: "Variables", topic: "Python variables", audience: "beginners" },
  { title: "Loops", topic: "Python for/while loops", audience: "beginners" },
]);
try {
  const res = await client.tool("batch_content", {
    template,
    variations,
    instruction: "Fill in the template for each variation. Write 2-3 sentences for the Content section.",
  });
  const text = getText(res);
  const hasMultiple = text.includes("Variables") && text.includes("Loops");
  assert(
    !isError(res) && hasMultiple,
    "batch_content: returns content for both variations",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "batch_content: returns content for both variations", e.message);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: FAIL

- [ ] **Step 3: Add prompt to prompts.js**

```javascript
  batch_content: () =>
    `You are a content batch generator. You will receive a template with {{placeholder}} variables, a list of variations (JSON array of objects), and optional instructions. For EACH variation, produce the filled-in content. Separate each output with a line containing only "---SEPARATOR---". Output the content directly — no fences, no numbering, no extra commentary. Just the filled content for each variation, separated by the separator line.`,
```

- [ ] **Step 4: Add input limit**

In `lib/config.js`, add to schema and DEFAULTS:

Schema: `batch_content_template: z.number().int().positive(),`
Default: `batch_content_template: 51200,`

- [ ] **Step 5: Create the tool**

Create `lib/tools/batch-content.js`:

```javascript
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
```

- [ ] **Step 6: Wire into index.js**

```javascript
import { registerBatchContent } from "./lib/tools/batch-content.js";
// ... after other registrations:
registerBatchContent(server, ollama, vramManager, config);
```

- [ ] **Step 7: Run tests**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
cd /home/digitalghost/projects/ollama-mcp
git add lib/tools/batch-content.js lib/prompts.js lib/config.js index.js test.js
git commit -m "feat: add batch_content tool for template-based bulk content generation"
```

---

### Task 8: Update CLAUDE.md with Offload Guidance

Update the global CLAUDE.md to include concrete offload rules so Claude Code actually uses these tools instead of forgetting they exist.

**Files:**
- Modify: `/home/digitalghost/.claude/CLAUDE.md`

- [ ] **Step 1: Add offload routing table**

Add to the `## Ollama Local Model Integration` section in `/home/digitalghost/.claude/CLAUDE.md`, replacing the existing bullet list with an expanded version:

```markdown
## Ollama Local Model Integration — Offload Rules

**MANDATORY offload — use these tools BEFORE spending Opus tokens on mechanical work:**

| Task Pattern | Tool | When to Use |
|---|---|---|
| Writing commit messages | `mcp__ollama__draft_commit_message` | EVERY commit unless multi-system architectural change |
| Exploring unfamiliar code | `mcp__ollama__explain_code` | Before reading large files, understanding new codebases |
| First-pass code review | `mcp__ollama__review_code` | Before doing a full review — pre-filter with local model |
| README generation | `mcp__ollama__generate_readme` | Any new README or README rewrite |
| Boilerplate code generation | `mcp__ollama__draft_code` | Config files, simple functions, scaffolding, repetitive patterns |
| Documentation drafts | `mcp__ollama__draft_content` | READMEs, docs, lessons, labs — draft locally, refine with Opus |
| File summarization | `mcp__ollama__summarize_file` | Compressing large files before processing |
| Mechanical refactoring | `mcp__ollama__refactor_code` | Renames, adding types/JSDoc, extracting functions |
| Changelogs | `mcp__ollama__generate_changelog` | Generating release notes from git log |
| Batch templated content | `mcp__ollama__batch_content` | Generating multiple files from a template (curricula, labs, etc.) |
| Task complexity routing | `mcp__ollama__classify_task` | Deciding whether a task needs Opus or can be handled locally |

**When NOT to offload:** Multi-file debugging, security analysis, architecture decisions, MCP protocol work, anything requiring tool use or network access.
```

- [ ] **Step 2: Commit**

```bash
git add /home/digitalghost/.claude/CLAUDE.md
git commit -m "docs: add comprehensive Ollama offload routing rules to CLAUDE.md"
```

---

### Task 9: Final Integration Test

Run the full test suite to verify all 16 tools (9 existing + 7 new) work together.

**Files:**
- Read: `test.js` (verify all tests present)

- [ ] **Step 1: Run full test suite**

Run: `cd /home/digitalghost/projects/ollama-mcp && npm test`
Expected: All 16+ tests PASS (9 original + 7 new)

- [ ] **Step 2: Verify tool count via MCP**

Run: `cd /home/digitalghost/projects/ollama-mcp && node -e "
import { spawn } from 'child_process';
const p = spawn('node', ['index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
p.stdout.on('data', d => { buf += d; for (const l of buf.split('\n')) { try { const m = JSON.parse(l); if (m.result?.tools) { console.log('Tools:', m.result.tools.length); m.result.tools.forEach(t => console.log(' -', t.name)); p.kill(); } } catch {} } buf = buf.includes('\n') ? buf.split('\n').pop() : buf; });
p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}}}) + '\n');
setTimeout(() => { p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}) + '\n'); }, 1000);
setTimeout(() => p.kill(), 5000);
"`
Expected: 16 tools listed

- [ ] **Step 3: Commit any final fixes**

If any tests failed, fix and commit. Otherwise, this step is a no-op.

- [ ] **Step 4: Final commit — bump version**

In `package.json`, change `"version": "1.0.0"` to `"version": "2.0.0"`.

```bash
cd /home/digitalghost/projects/ollama-mcp
git add package.json
git commit -m "chore: bump version to 2.0.0 for v2 release with 7 new tools"
```
