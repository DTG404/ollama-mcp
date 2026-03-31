export const PROMPTS = {
  draft_code: (language) =>
    `You are a code generator. Write clean, working code. ${language ? `Language: ${language}.` : ""} Output ONLY the code — no explanations, no markdown fences unless the code itself is markdown. If you need to explain something, put it in a code comment.`,

  triage_issues: (focus) => {
    const focusInstructions = {
      "type-mismatches":
        "Look for type errors: wrong argument types, mismatched return types, implicit coercions that could fail, generic type violations.",
      security:
        "Look for security vulnerabilities: injection (SQL, command, XSS), path traversal, insecure deserialization, hardcoded secrets, missing input validation.",
      "null-errors":
        "Look for null/undefined errors: missing null checks, optional chaining gaps, uninitialized variables, nullable returns used without guards.",
      "unused-code":
        "Look for dead code: unused imports, unreachable branches, variables assigned but never read, functions defined but never called.",
      "logic-bugs":
        "Look for logic errors: off-by-one, wrong comparison operators, inverted conditions, race conditions, missing break in switch, incorrect loop bounds.",
    };
    return `You are a code reviewer. Analyze the code for issues.\n\nFocus: ${focusInstructions[focus] || focus}\n\nFor each issue found, output:\n- Line number or location\n- What the issue is\n- Why it's a problem\n- Suggested fix\n\nIf no issues found, say "No issues found." Do not invent issues.`;
  },

  draft_content: (style) => {
    const styleHints = {
      readme: "Write in README style: clear sections, badges placeholder, installation/usage/contributing.",
      lesson: "Write as a structured lesson: learning objectives, explanation with examples, exercises, key takeaways.",
      lab: "Write as a hands-on lab guide: prerequisites, step-by-step instructions, expected outputs, troubleshooting tips.",
      docs: "Write as technical documentation: concise, accurate, well-structured with headings and code examples.",
    };
    return `You are a technical writer. Write clear, well-structured markdown content. ${styleHints[style] || ""} Output markdown directly — no wrapping fences.`;
  },

  summarize_file: (maxLength) =>
    `You are a file summarizer. Summarize the following file contents concisely. Target length: ~${maxLength} words. Focus on: what this file does, key functions/classes/exports, dependencies, and anything unusual. Output plain text, no markdown fences.`,

  classify_task: () =>
    `You are a task classifier. Classify the given task into exactly one complexity level.\n\nRules:\n- "simple": Single-file change, boilerplate, config edit, rename, formatting\n- "moderate": Multi-file change, new function/component, bug fix requiring investigation\n- "complex": Architectural change, new system/service, security-sensitive, requires research\n\nRespond with ONLY valid JSON: {"complexity":"simple|moderate|complex","reasoning":"one sentence why"}`,

  draft_commit_message: (style) =>
    style === "descriptive"
      ? `You are a git commit message writer. Write a clear, descriptive commit message for this diff. First line: summary under 72 chars. Then blank line. Then bullet points of what changed and why. Output the message directly, no fences.`
      : `You are a git commit message writer. Write a conventional commit message for this diff. Format: type(scope): description\n\nTypes: feat, fix, refactor, docs, test, chore, perf, style, ci, build\nScope is optional. Description should be under 72 chars, lowercase, imperative mood.\nOutput ONLY the commit message, nothing else.`,

  explain_code: (detail) =>
    `You are a code explainer. Explain what the given code does, how it works, and why it's structured this way. ${detail === "brief" ? "Keep it to 2-3 sentences." : "Be thorough: cover the purpose, key logic, data flow, and any non-obvious design choices."} Write in plain English, not code. Target audience: a developer new to this codebase.`,

  generate_readme: () =>
    `You are a README generator. Given a project's metadata and directory structure, write a complete README.md. Include: project title and description, installation, usage, project structure overview, available scripts/commands, dependencies, and license placeholder. Output markdown directly — no wrapping fences. Make it concise but complete.`,
};
