# Ollama MCP Server — Design Spec

**Date**: 2026-03-26
**Project**: `~/projects/ollama-mcp/`
**Goal**: MCP server that offloads token-heavy tasks to local Ollama models, saving Claude API tokens without significantly reducing output quality.

---

## Problem

Claude burns tokens on tasks that don't require frontier-model reasoning: drafting content, generating boilerplate, summarizing files, writing commit messages. Across 57 sessions and 491 commits in one week, the largest token sinks are:

1. Generating structured content (196 Python lessons, 16 DevOps labs, 30 game missions)
2. Repetitive fix cycles that re-read entire codebases
3. Documentation and README generation
4. Design specs and implementation plan drafting
5. Commit message generation (491/week)

A local Ollama-backed MCP server lets Claude delegate these tasks to local models. Claude either uses the output directly (fire-and-forget) or polishes a 70% draft (review-and-refine), both cheaper than generating from scratch.

---

## Architecture

```
Claude --> MCP Server (stdio) --> VRAM Manager --> Ollama API (localhost:11434)
```

### Tool Groups

The server organizes tools into three groups, each with a model preference chain. The VRAM manager walks the chain and picks the largest model that fits in available GPU memory.

**Code Group** — prefers coder-specific models
- `draft_code`
- `triage_issues`
- Default chain: `[qwen2.5-coder:14b, qwen2.5-coder:7b, qwen3.5:4b]`
- Temperature: 0.3

**Content Group** — prefers general models with large context
- `draft_content`
- `summarize_file`
- Default chain: `[qwen3.5:9b, qwen3.5:4b, qwen3.5:0.8b]`
- Temperature: 0.7

**Utility Group** — prefers small/fast models
- `draft_commit_message`
- Default chain: `[qwen3.5:4b, qwen3.5:0.8b]`
- Temperature: 0.2

**Routing Group** — deterministic classification
- `classify_task`
- Default chain: `[qwen3.5:0.8b]`
- Temperature: 0.0

**Management Tools** — no model needed
- `list_models`
- `check_model_updates`
- `get_config`

---

## Hardware Context

- GPU: NVIDIA GeForce RTX 4070 Ti (12GB VRAM)
- RAM: 32GB system
- OS: CachyOS (Arch-based)
- Ollama: v0.18.2, running as systemd service (enabled at boot)

---

## VRAM Manager

Answers one question: "What's the biggest model I can load right now?"

### Selection Algorithm

1. Query Ollama `/api/ps` for currently loaded models and their VRAM usage
2. Query `nvidia-smi` for total and free VRAM (cached for 5 seconds)
3. Receive a model preference chain from the requesting tool group
4. Walk the chain top-to-bottom:
   a. If model is **already loaded** in Ollama (from `/api/ps`) -> use immediately
   b. If model is **pulled** (in `/api/tags`) and **fits in free VRAM** (with 1GB buffer) -> use it
   c. Otherwise -> skip to next in chain
5. If no model fits -> return error listing what's needed

### Model Size Discovery

Sizes are queried dynamically, not hardcoded:
- **Loaded models**: `/api/ps` returns `size_vram` (exact bytes in GPU)
- **Pulled but unloaded**: `/api/show` returns model size (VRAM ~= file size for GGUF)
- **Not pulled**: fail gracefully per missing model policy

Size data is cached alongside the VRAM check (5-second TTL). Refreshed on each tool call that exceeds the TTL.

### Context Window Awareness

Before sending a request to Ollama, the VRAM manager also checks context fit:
- Query `/api/show` for the selected model's context window size
- Estimate token count from input length (~4 chars per token heuristic)
- If input exceeds model's context window -> return error: "Input too large for {model} ({estimated_tokens} tokens, max {context_limit}). Reduce input size or chunk the content."

### VRAM Buffer

Reserve 1GB headroom. If `nvidia-smi` reports 10GB free, effective budget is 9GB. This accounts for GPU memory used by desktop compositor, Steam, Cortex Desktop, and other processes.

### VRAM Race Condition Handling

If Ollama returns an OOM or model load error:
1. Re-run VRAM check (fresh, bypass cache)
2. Fall back to the next model in the preference chain
3. One retry attempt, then fail with error

### No Model Unloading

The server never tells Ollama to unload models. Ollama manages its own eviction policy.

---

## Tool Definitions

### Code Group

#### `draft_code`

**Strategy**: review-and-refine (Claude polishes the output)

**Description**: "Generate a first draft of code using a local model. Returns a draft that may need refinement — use it as a starting point, not production-ready output."

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | yes | What to generate |
| `language` | string | no | Target language (helps model focus) |
| `context` | string | no | Existing code for reference (max 50KB) |

**Model chain**: `[qwen2.5-coder:14b, qwen2.5-coder:7b, qwen3.5:4b]`

#### `triage_issues`

**Strategy**: review-and-refine (Claude confirms/filters the findings)

**Description**: "Scan code for specific issue types using a local model. Returns candidate issues that should be verified — may contain false positives."

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | yes | Source code to analyze (max 100KB) |
| `focus` | string | yes | One of: `type-mismatches`, `security`, `null-errors`, `unused-code`, `logic-bugs` |

**Model chain**: `[qwen2.5-coder:14b, qwen2.5-coder:7b, qwen3.5:4b]`

---

### Content Group

#### `draft_content`

**Strategy**: review-and-refine (Claude polishes the output)

**Description**: "Draft technical content using a local model. Returns a rough draft intended for Claude to review and refine."

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | yes | What to write |
| `style` | string | no | One of: `readme`, `lesson`, `lab`, `docs` |
| `reference` | string | no | Existing content to match tone/format (max 50KB) |

**Model chain**: `[qwen3.5:9b, qwen3.5:4b, qwen3.5:0.8b]`

#### `summarize_file`

**Strategy**: fire-and-forget (Claude consumes the summary directly)

**Description**: "Summarize file contents using a local model. Use this to compress large files before processing them — saves tokens by reducing input size."

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | File contents to summarize (max 200KB) |
| `max_length` | number | no | Target summary length in words (default 200) |

**Model chain**: `[qwen3.5:4b, qwen3.5:0.8b]`

---

### Utility Group

#### `classify_task`

**Strategy**: fire-and-forget (Claude uses classification directly)

**Description**: "Classify task complexity using a local model. Returns a complexity rating to help decide whether to handle locally or use Claude."

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | yes | Task description to classify (max 5KB) |

**Output format**: `{ complexity: "simple" | "moderate" | "complex", reasoning: string }`

If model output can't be parsed as valid JSON, return: `{ complexity: "moderate", reasoning: "classification failed — defaulting to moderate" }`

**Model chain**: `[qwen3.5:0.8b]`

#### `draft_commit_message`

**Strategy**: fire-and-forget (Claude uses message directly)

**Description**: "Generate a conventional commit message from a git diff using a local model."

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `diff` | string | yes | Git diff to summarize (max 50KB) |
| `style` | string | no | One of: `conventional` (default), `descriptive` |

**Model chain**: `[qwen3.5:4b, qwen3.5:0.8b]`

---

### Management Tools

#### `list_models`

**Description**: "List all Ollama models: what's pulled, their sizes, which tool group they're assigned to, and what's currently loaded in VRAM."

No parameters. No model needed.

#### `check_model_updates`

**Description**: "Check if any pulled models have newer versions available on the Ollama registry."

No parameters. No model needed. Compares local digests against registry digests via Ollama API.

#### `get_config`

**Description**: "Return the current server configuration: tool group to model preference chain mappings, temperatures, and limits."

No parameters. No model needed.

---

## Input Size Limits

Every tool enforces a max input size. Requests exceeding the limit are rejected before hitting Ollama.

| Tool | Max Input | Rationale |
|------|-----------|-----------|
| `draft_code` context | 50KB | Larger context floods small models |
| `triage_issues` code | 100KB | Code review needs more context than generation |
| `summarize_file` content | 200KB | Summarization can handle larger inputs |
| `draft_content` reference | 50KB | Reference material, not the full output |
| `draft_commit_message` diff | 50KB | Diffs beyond this should be summarized first |
| `classify_task` task | 5KB | Classification is a short-input task |

Error format: "Input exceeds maximum size for {tool} ({actual_size} > {max_size}). Reduce input or break it into chunks."

---

## Response Format

Every tool returns the standard MCP response. Metadata is appended as a fenced JSON block after the main output, so Claude can read it without special parsing:

```json
{
  "content": [{
    "type": "text",
    "text": "The generated output...\n\n```json meta\n{\"model\":\"qwen2.5-coder:14b\",\"loadTimeMs\":12400,\"generateTimeMs\":8230,\"totalTimeMs\":20630,\"tokensGenerated\":342,\"fellBack\":false,\"originalModel\":\"qwen2.5-coder:14b\"}\n```"
  }]
}
```

When a fallback occurs, `fellBack` is `true` and `originalModel` shows what was attempted first.

---

## Configuration

Config file: `~/.ollama-mcp/config.json`

Created with defaults on first run. Validated with Zod schema on startup. If invalid, the server logs the specific validation error and falls back to hardcoded defaults (does not crash).

```json
{
  "ollama": {
    "host": "http://localhost:11434",
    "timeoutMs": 120000
  },
  "vram": {
    "bufferMb": 1024,
    "cacheTtlMs": 5000
  },
  "groups": {
    "code": {
      "models": ["qwen2.5-coder:14b", "qwen2.5-coder:7b", "qwen3.5:4b"],
      "temperature": 0.3
    },
    "content": {
      "models": ["qwen3.5:9b", "qwen3.5:4b", "qwen3.5:0.8b"],
      "temperature": 0.7
    },
    "utility": {
      "models": ["qwen3.5:4b", "qwen3.5:0.8b"],
      "temperature": 0.2
    },
    "routing": {
      "models": ["qwen3.5:0.8b"],
      "temperature": 0.0
    }
  },
  "inputLimits": {
    "draft_code_context": 51200,
    "triage_issues_code": 102400,
    "summarize_file_content": 204800,
    "draft_content_reference": 51200,
    "draft_commit_message_diff": 51200,
    "classify_task_task": 5120
  }
}
```

MCP registration in Claude config:

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

---

## Error Handling

### Ollama Not Running

- Check connectivity on every tool call (hit `/api/tags`)
- Error: "Ollama is not running. Start it with `ollama serve` or check `systemctl status ollama`"

### Model Not Pulled

- VRAM manager skips unpulled models in the preference chain
- If entire chain is unpulled -> error: "No models available for {group} group. Run `ollama pull {first_model_in_chain}`"

### No GPU / nvidia-smi Not Found

- Fall back to CPU-only mode, pick smallest model in chain
- Log warning but don't fail

### VRAM Too Full

- Walk down preference chain until something fits
- If nothing fits -> error: "GPU memory full ({used}GB/{total}GB used). Free VRAM or wait for Ollama to unload idle models"

### VRAM Race Condition

- If Ollama returns OOM or model load failure:
  1. Invalidate VRAM cache
  2. Re-check VRAM
  3. Fall back to next model in chain
  4. One retry, then fail with error

### Ollama Timeout

- Default 120 seconds (configurable)
- On timeout -> error: "Generation timed out after {timeout}ms. Try a smaller model or shorter prompt"

### Empty Model Output

- Every tool checks for empty/whitespace-only responses
- Error: "Model returned empty response. Try a larger model or simpler prompt"
- Includes model name and input size in error for debugging

### Context Window Overflow

- Estimate tokens from input length (~4 chars/token)
- Compare against model's context window (from `/api/show`)
- Reject before sending to Ollama: "Input too large for {model} ({estimated_tokens} tokens, max {context_limit}). Reduce input size or chunk the content."

### Input Size Exceeded

- Check byte length of each input parameter against configured limits
- Reject immediately: "Input exceeds maximum size for {tool} ({actual} > {limit} bytes). Reduce input or break it into chunks."

### Config File Invalid

- Validate with Zod schema on startup
- If invalid: log specific error, fall back to hardcoded defaults, continue running
- If missing: create with defaults

### Malformed Classification Output

- `classify_task` expects `{ complexity, reasoning }` JSON
- If unparseable: return `{ complexity: "moderate", reasoning: "classification failed — defaulting to moderate" }`

### Ollama API Version

- Check Ollama version on startup via `/api/version`
- If outside tested range (0.18.x - 0.x.x): log warning, continue running
- Don't block — just inform

---

## Technology Stack

- **Runtime**: Node.js (>=18)
- **MCP SDK**: `@modelcontextprotocol/sdk` (^1.27)
- **Validation**: `zod`
- **Transport**: stdio (standard for CLI-launched MCP servers)
- **Architecture**: Single `index.js` entry point, matching dtg-obsidian-mcp pattern
- **No additional dependencies** beyond MCP SDK and Zod

Ollama communication is plain HTTP via `fetch()` (built into Node 18+). nvidia-smi queries via `child_process.execSync`. No Ollama client library needed.

---

## Project Structure

```
ollama-mcp/
  index.js              # MCP server, tools, VRAM manager, Ollama client
  package.json
  config.schema.js      # Zod schema for config validation
  test.js               # Tool tests (matching dtg-obsidian-mcp pattern)
  README.md
  .mcp.json.example     # Example Claude MCP config
  .gitignore
```

---

## What This Does NOT Do

- **No auto-pulling models** — user manages their own model library
- **No model unloading** — Ollama handles eviction
- **No model fine-tuning or custom modelfiles** — uses stock Ollama models
- **No streaming** — returns complete responses (MCP tools are request/response)
- **No persistent state** — stateless between calls, config on disk
- **No web UI** — CLI MCP server only
