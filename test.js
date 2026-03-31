#!/usr/bin/env node
/**
 * ollama-mcp — Full test suite
 * Spawns the MCP server as a subprocess and communicates via JSON-RPC over stdio.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Colours ──────────────────────────────────────────────────────────────────
const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const B = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

// ─── MCP client ───────────────────────────────────────────────────────────────
class McpTestClient {
  constructor() {
    this.proc = null;
    this.buffer = "";
    this.pending = new Map();
    this.nextId = 1;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn("node", [path.join(__dirname, "index.js")], {
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.proc.stdout.on("data", (chunk) => {
        this.buffer += chunk.toString();
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop(); // keep incomplete last line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            const resolve = this.pending.get(msg.id);
            if (resolve) {
              this.pending.delete(msg.id);
              resolve(msg);
            }
          } catch {
            /* ignore non-JSON lines */
          }
        }
      });

      this.proc.stderr.on("data", () => {}); // suppress server logs

      this.proc.on("error", reject);

      // Send initialize
      this.call("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "ollama-mcp-test", version: "1" },
      }).then((res) => {
        // Send initialized notification (no response expected)
        const notif = JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }) + "\n";
        this.proc.stdin.write(notif);
        resolve(res);
      }).catch(reject);
    });
  }

  call(method, params = {}, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      this.proc.stdin.write(msg);
    });
  }

  tool(name, args = {}, timeoutMs = 180000) {
    return this.call("tools/call", { name, arguments: args }, timeoutMs);
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.proc) return resolve();
      this.proc.on("close", resolve);
      this.proc.kill();
    });
  }
}

// ─── Test runner ──────────────────────────────────────────────────────────────
const results = [];

function assert(condition, testName, detail = "") {
  if (condition) {
    results.push({ name: testName, pass: true, detail });
  } else {
    results.push({ name: testName, pass: false, detail });
  }
}

function getText(res) {
  return res?.result?.content?.[0]?.text ?? "";
}

function isError(res) {
  return !!(res?.error || res?.result?.isError);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(B("\nollama-mcp — Test Suite\n"));

const client = new McpTestClient();

// ── Server Init ──────────────────────────────────────────────────────────────
console.log(Y("Server Init"));
let initRes;
try {
  initRes = await client.start();
  const serverName = initRes?.result?.serverInfo?.name ?? "";
  assert(serverName === "ollama", "server init: name is 'ollama'", `serverInfo.name = "${serverName}"`);
} catch (e) {
  assert(false, "server init: name is 'ollama'", `Failed to start: ${e.message}`);
  console.log(R("Fatal: could not start server. Aborting."));
  process.exit(1);
}

// ── list_models ───────────────────────────────────────────────────────────────
console.log(Y("\nlist_models"));
try {
  const res = await client.tool("list_models");
  const text = getText(res);
  assert(
    text.includes("Ollama Models"),
    "list_models: returns markdown table with 'Ollama Models'",
    text.slice(0, 100)
  );
} catch (e) {
  assert(false, "list_models: returns markdown table with 'Ollama Models'", e.message);
}

// ── get_config ────────────────────────────────────────────────────────────────
console.log(Y("\nget_config"));
try {
  const res = await client.tool("get_config");
  const text = getText(res);
  assert(
    text.includes("ollama") && text.includes("groups"),
    "get_config: response contains 'ollama' and 'groups'",
    text.slice(0, 100)
  );
} catch (e) {
  assert(false, "get_config: response contains 'ollama' and 'groups'", e.message);
}

// ── classify_task ─────────────────────────────────────────────────────────────
console.log(Y("\nclassify_task"));
try {
  const res = await client.tool("classify_task", { task: "add a CSS class to a button" });
  const text = getText(res);
  const hasComplexity = text.includes("complexity");
  const hasJsonMeta = text.includes("json meta");
  assert(
    !isError(res) && hasComplexity && hasJsonMeta,
    "classify_task: contains 'complexity' and 'json meta' block",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "classify_task: contains 'complexity' and 'json meta' block", e.message);
}

// ── classify_task input limit ─────────────────────────────────────────────────
console.log(Y("\nclassify_task input limit"));
try {
  const bigInput = "x".repeat(6000);
  const res = await client.tool("classify_task", { task: bigInput }, 15000);
  const text = getText(res);
  assert(
    isError(res) && text.includes("exceeds maximum"),
    "classify_task: rejects input >5KB with 'exceeds maximum'",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "classify_task: rejects input >5KB with 'exceeds maximum'", e.message);
}

// ── draft_commit_message ──────────────────────────────────────────────────────
console.log(Y("\ndraft_commit_message"));
const testDiff = `diff --git a/src/button.js b/src/button.js
index a1b2c3d..e4f5a6b 100644
--- a/src/button.js
+++ b/src/button.js
@@ -1,5 +1,8 @@
 export function Button({ label, onClick }) {
-  return <button>{label}</button>;
+  return (
+    <button className="btn-primary" onClick={onClick}>
+      {label}
+    </button>
+  );
 }`;
try {
  const res = await client.tool("draft_commit_message", { diff: testDiff });
  const text = getText(res);
  assert(
    !isError(res) && text.trim().length > 0 && text.includes("json meta"),
    "draft_commit_message: non-empty response with 'json meta' block",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "draft_commit_message: non-empty response with 'json meta' block", e.message);
}

// ── summarize_file ────────────────────────────────────────────────────────────
console.log(Y("\nsummarize_file"));
const testCode = `/**
 * Fibonacci — returns the nth Fibonacci number using memoization.
 */
const memo = {};
function fib(n) {
  if (n <= 1) return n;
  if (memo[n]) return memo[n];
  memo[n] = fib(n - 1) + fib(n - 2);
  return memo[n];
}
export default fib;`;
try {
  const res = await client.tool("summarize_file", { content: testCode });
  const text = getText(res);
  assert(
    !isError(res) && text.trim().length > 0,
    "summarize_file: returns a non-empty summary",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "summarize_file: returns a non-empty summary", e.message);
}

// ── draft_content ─────────────────────────────────────────────────────────────
console.log(Y("\ndraft_content"));
try {
  const res = await client.tool("draft_content", {
    prompt: "Write a 3-sentence description of what an MCP server is.",
  });
  const text = getText(res);
  assert(
    !isError(res) && text.trim().length > 0,
    "draft_content: returns content for a 3-sentence request",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "draft_content: returns content for a 3-sentence request", e.message);
}

// ── draft_code ────────────────────────────────────────────────────────────────
console.log(Y("\ndraft_code"));
try {
  const res = await client.tool("draft_code", {
    prompt: "Write a JavaScript function called add that takes two numbers and returns their sum.",
    language: "javascript",
  });
  const text = getText(res);
  const hasAddOrFunction = text.includes("add") || text.includes("function");
  assert(
    !isError(res) && hasAddOrFunction,
    "draft_code: response contains 'add' or 'function'",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "draft_code: response contains 'add' or 'function'", e.message);
}

// ── triage_issues ─────────────────────────────────────────────────────────────
console.log(Y("\ntriage_issues"));
const buggyCode = `function getUser(id) {
  const user = db.find(id);
  return user.name.toUpperCase(); // potential null dereference
}`;
try {
  const res = await client.tool("triage_issues", { code: buggyCode, focus: "null-errors" });
  const text = getText(res);
  assert(
    !isError(res) && text.trim().length > 0,
    "triage_issues: returns results for code with potential null error",
    text.slice(0, 120)
  );
} catch (e) {
  assert(false, "triage_issues: returns results for code with potential null error", e.message);
}

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

// ─── Cleanup & Report ─────────────────────────────────────────────────────────
await client.stop();

const passed = results.filter((r) => r.pass);
const failed = results.filter((r) => !r.pass);

console.log(B("\n─────────────────────────────────────────"));
console.log(B("Results\n"));

for (const r of results) {
  if (r.pass) {
    console.log(`${G("PASS")} ${r.name.padEnd(55)} ${DIM(String(r.detail).replace(/\n/g, " ").slice(0, 80))}`);
  } else {
    console.log(`${R("FAIL")} ${r.name.padEnd(55)} ${Y(String(r.detail))}`);
  }
}

console.log(B("\n─────────────────────────────────────────"));
console.log(
  `${G(`PASS ${passed.length}`)}  ${failed.length ? R(`FAIL ${failed.length}`) : ""}  / ${results.length} total\n`
);

if (failed.length) process.exit(1);
