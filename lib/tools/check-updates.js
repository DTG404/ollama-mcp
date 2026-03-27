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
