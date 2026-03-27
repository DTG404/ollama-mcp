export function registerGetConfig(server, config) {
  server.tool(
    "get_config",
    "Return the current server configuration: tool group to model preference chain mappings, temperatures, and limits.",
    {},
    async () => {
      const output = JSON.stringify(config, null, 2);
      return {
        content: [{ type: "text", text: `\`\`\`json\n${output}\n\`\`\`` }],
      };
    }
  );
}
