/**
 * VRAM-aware model selection engine.
 * Queries nvidia-smi for GPU free memory and uses Ollama's running/pulled model
 * lists to pick the best model from a priority chain.
 */

import { execFileSync } from "child_process";

export class VramManager {
  /**
   * @param {import('./ollama-client.js').OllamaClient} ollama
   * @param {{ bufferMb: number, cacheTtlMs: number }} vramConfig
   */
  constructor(ollama, vramConfig) {
    this.ollama = ollama;
    this.bufferBytes = vramConfig.bufferMb * 1024 * 1024;
    this.cacheTtlMs = vramConfig.cacheTtlMs;
    this._cache = null;
    this._cacheTime = 0;
  }

  /**
   * Query the GPU for free VRAM via nvidia-smi.
   * Returns free bytes as a number, or null if unavailable.
   * @returns {number|null}
   */
  _queryGpuFreeBytes() {
    try {
      const output = execFileSync(
        "nvidia-smi",
        ["--query-gpu=memory.free", "--format=csv,noheader,nounits"],
        { timeout: 5000, encoding: "utf-8" }
      );
      const firstLine = output.trim().split("\n")[0].trim();
      const mib = parseInt(firstLine, 10);
      if (isNaN(mib)) return null;
      return mib * 1024 * 1024;
    } catch {
      return null;
    }
  }

  /**
   * Get the current VRAM state, using cache when within TTL.
   * @param {boolean} [bypassCache=false]
   * @returns {Promise<{ freeBytes: number|null, loadedModels: Map<string, number>, pulledModels: Map<string, number> }>}
   */
  async getVramState(bypassCache = false) {
    const now = Date.now();
    if (!bypassCache && this._cache !== null && now - this._cacheTime < this.cacheTtlMs) {
      return this._cache;
    }

    const [running, models] = await Promise.all([
      this.ollama.listRunning(),
      this.ollama.listModels(),
    ]);

    // Build map of currently loaded models: name -> size_vram bytes
    const loadedModels = new Map();
    for (const m of running) {
      if (m.name && m.size_vram != null) {
        loadedModels.set(m.name, m.size_vram);
      }
    }

    // Build map of all pulled (locally available) models: name -> size bytes
    const pulledModels = new Map();
    for (const m of models) {
      if (m.name && m.size != null) {
        pulledModels.set(m.name, m.size);
      }
    }

    const freeBytes = this._queryGpuFreeBytes();

    const state = { freeBytes, loadedModels, pulledModels };
    this._cache = state;
    this._cacheTime = now;

    return state;
  }

  /**
   * Select the best model from a priority chain.
   * Pass 1: return an already-loaded model immediately.
   * Pass 2: if GPU available, pick first model that is pulled and fits in VRAM.
   * Fallback (no GPU): pick smallest pulled model.
   * Throws if nothing suitable is found.
   * @param {string[]} chain - Ordered list of model names (most preferred first)
   * @returns {Promise<string>} - Selected model name
   */
  async selectModel(chain) {
    const state = await this.getVramState();
    const { freeBytes, loadedModels, pulledModels } = state;

    // Pass 1: prefer already-loaded models (in chain priority order)
    for (const model of chain) {
      if (loadedModels.has(model)) {
        return { model, reason: "already loaded in VRAM" };
      }
    }

    // Pass 2: GPU available — walk chain and pick first that fits
    if (freeBytes !== null) {
      const available = freeBytes - this.bufferBytes;
      const notPulled = [];
      const tooLarge = [];

      for (const model of chain) {
        if (!pulledModels.has(model)) {
          notPulled.push(model);
          continue;
        }
        const size = pulledModels.get(model);
        if (size <= available) {
          return { model, reason: `fits in VRAM (${(size / 1e9).toFixed(1)}GB model, ${(available / 1e9).toFixed(1)}GB free)` };
        } else {
          tooLarge.push({ model, size });
        }
      }

      // Nothing fit — build a helpful error message
      const freeMb = Math.round(freeBytes / 1024 / 1024);
      const bufMb = Math.round(this.bufferBytes / 1024 / 1024);
      const availMb = Math.round(available / 1024 / 1024);
      const tooLargeDesc = tooLarge
        .map(({ model, size }) => `${model} (${Math.round(size / 1024 / 1024)} MiB)`)
        .join(", ");
      const notPulledDesc = notPulled.length > 0 ? notPulled.join(", ") : "none";

      throw new Error(
        `No model in chain fits in VRAM. ` +
        `GPU free: ${freeMb} MiB, buffer: ${bufMb} MiB, usable: ${availMb} MiB. ` +
        `Too large: [${tooLargeDesc || "none"}]. ` +
        `Not pulled: [${notPulledDesc}].`
      );
    }

    // No GPU fallback: pick the highest-priority pulled model from the chain
    for (const model of chain) {
      if (pulledModels.has(model)) {
        return { model, reason: "no GPU detected — CPU fallback (first available in chain)" };
      }
    }

    // Nothing pulled at all
    const pullCmds = chain.map((m) => `ollama pull ${m}`).join(", ");
    throw new Error(
      `No models from chain are pulled locally. ` +
      `Chain: [${chain.join(", ")}]. ` +
      `Pull one or more with: ${pullCmds}`
    );
  }

  /**
   * Handle an OOM failure by invalidating cache, removing the failed model,
   * and re-running selection on the remaining chain.
   * @param {string} failedModel
   * @param {string[]} chain
   * @returns {Promise<string>}
   */
  async retryAfterOom(failedModel, chain) {
    // Invalidate cache
    this._cache = null;
    this._cacheTime = 0;

    const remaining = chain.filter((m) => m !== failedModel);
    if (remaining.length === 0) {
      throw new Error(
        `OOM on "${failedModel}" and no remaining models in chain: [${chain.join(", ")}].`
      );
    }

    return this.selectModel(remaining);
  }
}
