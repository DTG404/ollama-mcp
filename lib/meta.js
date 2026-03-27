/**
 * Formats tool output with appended metadata block.
 */
export function formatResponse(text, meta) {
  const metaBlock = `\n\n\`\`\`json meta\n${JSON.stringify(meta)}\n\`\`\``;
  return {
    content: [{ type: "text", text: text + metaBlock }],
  };
}

/**
 * Formats an error response.
 */
export function formatError(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
