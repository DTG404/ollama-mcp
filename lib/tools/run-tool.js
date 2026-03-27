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
    } else if (err.name === "TimeoutError" || err.message.includes("timed out") || err.name === "AbortError") {
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
