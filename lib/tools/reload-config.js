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
