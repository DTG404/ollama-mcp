# ollama-mcp

VRAM-aware MCP server that offloads token-heavy development tasks to local Ollama models, saving API tokens for complex reasoning.

## Tools

| Tool | Description |
|------|-------------|
| `draft_code` | Generate boilerplate and scaffolding |
| `draft_commit_message` | Write commit messages from diffs |
| `draft_content` | Draft documentation and prose |
| `classify_task` | Auto-route work to the right agent type |
| `summarize_file` | Summarize unfamiliar source files |
| `triage_issues` | Classify and prioritize issues |
| `list_models` | List available Ollama models |
| `check_updates` | Check for model updates |
| `get_config` | Show current configuration |

## VRAM Management

The server monitors GPU memory via `nvidia-smi` and selects models based on available VRAM. Models are loaded on demand.

## Setup

```bash
npm install
```

Requires [Ollama](https://ollama.ai) running locally with models pulled.

## Usage

```bash
npm start
```

Configure in Claude Code MCP settings:

```json
{
  "mcpServers": {
    "ollama": {
      "command": "node",
      "args": ["/path/to/ollama-mcp/index.js"]
    }
  }
}
```

## Tech Stack

- Node.js (>=18)
- `@modelcontextprotocol/sdk`
- Zod for schema validation
- Ollama API for local model inference
- `nvidia-smi` for VRAM monitoring
