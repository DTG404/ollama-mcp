/**
 * Thin HTTP client for the Ollama REST API using native fetch().
 * No external dependencies required.
 */
export class OllamaClient {
  /**
   * @param {string} host - Base URL for Ollama (e.g. "http://localhost:11434")
   * @param {number} timeoutMs - Default timeout in milliseconds for generate calls
   */
  constructor(host, timeoutMs) {
    this.host = host.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  /**
   * Make a GET request to the given path.
   * @param {string} path
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  async #get(path, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);
    try {
      const res = await fetch(`${this.host}${path}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Make a POST request to the given path with a JSON body.
   * @param {string} path
   * @param {object} body
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  async #post(path, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);
    try {
      const res = await fetch(`${this.host}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Check whether the Ollama server is reachable.
   * Uses a hard-coded 5s timeout regardless of the configured timeout.
   * @returns {Promise<boolean>}
   */
  async isReachable() {
    try {
      await this.#get('/api/tags', 5000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the Ollama server version string.
   * @returns {Promise<string>}
   */
  async getVersion() {
    const data = await this.#get('/api/version');
    return data.version;
  }

  /**
   * List all locally available models.
   * @returns {Promise<object[]>}
   */
  async listModels() {
    const data = await this.#get('/api/tags');
    return data.models || [];
  }

  /**
   * List currently running models.
   * Each entry has: name, size, size_vram
   * @returns {Promise<object[]>}
   */
  async listRunning() {
    const data = await this.#get('/api/ps');
    return data.models || [];
  }

  /**
   * Show detailed information about a model.
   * @param {string} model
   * @returns {Promise<{contextLength: number, size: number|undefined, parameters: string|undefined}>}
   */
  async showModel(model) {
    const data = await this.#post('/api/show', { name: model });

    const info = data.model_info || {};
    // Context length key varies by architecture (llama.context_length, qwen35.context_length, etc.)
    // Search for any key ending in .context_length
    const ctxKey = Object.keys(info).find((k) => k.endsWith(".context_length"));
    const contextLength = ctxKey ? info[ctxKey] : 4096;

    return {
      contextLength,
      size: data.size || 0,
      parameters: data.details?.parameter_size || "unknown",
    };
  }

  /**
   * Generate a completion using the given model.
   * Durations from Ollama are in nanoseconds; they are converted to milliseconds.
   * @param {string} model
   * @param {string} prompt
   * @param {string} system
   * @param {number} temperature
   * @returns {Promise<{response: string, totalDuration: number, loadDuration: number, evalCount: number}>}
   */
  async generate(model, prompt, system, temperature) {
    const data = await this.#post(
      '/api/generate',
      {
        model,
        prompt,
        system,
        stream: false,
        options: { temperature },
      },
      this.timeoutMs,
    );

    return {
      response: data.response,
      totalDuration: Math.round((data.total_duration ?? 0) / 1e6),
      loadDuration: Math.round((data.load_duration ?? 0) / 1e6),
      evalCount: data.eval_count,
    };
  }

  /**
   * Check whether an update is available for the given model.
   * Compares the local digest against what the registry returns after a pull.
   * @param {string} model
   * @returns {Promise<{name: string, updateAvailable: boolean, localDigest: string|undefined}>}
   */
  async checkUpdate(model) {
    const models = await this.listModels();
    const local = models.find((m) => m.name === model);
    const localDigest = local?.digest;

    const data = await this.#post('/api/pull', { name: model, stream: false }, 30000);

    // When the model is already up to date, the status is "success" and no new digest is reported.
    // If a newer digest is present in the response and differs from the local one, an update was pulled.
    const remoteDigest = data.digest;
    const updateAvailable =
      remoteDigest !== undefined && localDigest !== undefined && remoteDigest !== localDigest;

    return { name: model, updateAvailable, localDigest };
  }
}
