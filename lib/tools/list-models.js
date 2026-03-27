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

      const [models, running, vramState] = await Promise.all([
        ollama.listModels(),
        ollama.listRunning(),
        vramManager.getVramState(),
      ]);

      const loadedSet = new Set(running.map((r) => r.name));
      const { freeBytes } = vramState;
      const hasGpu = freeBytes !== null;
      const availableBytes = hasGpu ? freeBytes - vramManager.bufferBytes : null;

      // Build group membership map
      const groupMap = new Map();
      for (const [groupName, groupConfig] of Object.entries(config.groups)) {
        for (const model of groupConfig.models) {
          if (!groupMap.has(model)) groupMap.set(model, []);
          groupMap.get(model).push(groupName);
        }
      }

      let output = "# Ollama Models\n\n";

      if (hasGpu) {
        const freeGb = (freeBytes / 1e9).toFixed(1);
        const bufferGb = (vramManager.bufferBytes / 1e9).toFixed(1);
        const availGb = (availableBytes / 1e9).toFixed(1);
        output += `**GPU VRAM:** ${freeGb}GB free, ${bufferGb}GB buffer, ${availGb}GB usable\n\n`;
      } else {
        output += `**GPU VRAM:** No GPU detected\n\n`;
      }

      output += `| Model | Size | Status | Fits? | Groups |\n`;
      output += `|-------|------|--------|-------|--------|\n`;

      for (const m of models) {
        const sizeGb = (m.size / 1e9).toFixed(1);
        const isLoaded = loadedSet.has(m.name);
        const status = isLoaded ? "**LOADED**" : "pulled";
        let fits;
        if (isLoaded) {
          fits = "LOADED";
        } else if (!hasGpu) {
          fits = "No GPU";
        } else {
          fits = m.size <= availableBytes ? "YES" : "NO";
        }
        const groups = groupMap.get(m.name)?.join(", ") || "—";
        output += `| ${m.name} | ${sizeGb}GB | ${status} | ${fits} | ${groups} |\n`;
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
