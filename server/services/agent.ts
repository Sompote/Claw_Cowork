/**
 * Claw Cowork Agent
 *
 * Adopts openclaw's agent architecture:
 *  - Sectioned system prompt (Identity / Tooling / Workspace / Skills / Memory)
 *  - Subagent spawning with depth tracking (max depth = 3)
 *  - Tool policy enforcement per project access level
 *  - Reflection loop for self-evaluation and gap-filling
 *
 * API is OpenAI-compatible (works with OpenRouter, any OpenAI-compat endpoint).
 */

import { getSettings } from "./data";
import { getTools, callTool } from "./toolbox";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface AgentResponse {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  toolResults?: Array<{ tool: string; result: any }>;
}

// ─── API Config ───────────────────────────────────────────────────────────────

function getApiConfig() {
  const settings = getSettings();
  const apiKey = settings.apiKey;
  const model = settings.apiModel || "openai/gpt-4o-mini";
  const rawUrl = settings.apiUrl || "https://openrouter.ai/api/v1/chat/completions";
  const apiUrl = rawUrl.endsWith("/chat/completions")
    ? rawUrl
    : rawUrl.replace(/\/$/, "") + "/chat/completions";
  return { apiKey, model, apiUrl };
}

// ─── LLM Single Call ─────────────────────────────────────────────────────────

async function llmCall(
  messages: ChatMessage[],
  options: { tools?: any[]; model?: string } = {}
): Promise<any> {
  const { apiKey, model, apiUrl } = getApiConfig();
  if (!apiKey) throw new Error("API key not configured");

  const settings = getSettings();
  const body: any = {
    model: options.model || model,
    messages,
    temperature: settings.agentTemperature ?? 0.7,
    max_tokens: 81920,
  };
  if (options.tools && options.tools.length) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://claw-cowork.local",
      "X-Title": "Claw Cowork",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error (${response.status}): ${error}`);
  }

  const json = await response.json();
  if (!json.choices?.length) {
    console.error(`[llmCall] API returned no choices:`, JSON.stringify(json).slice(0, 1000));
  }
  return json;
}

// ─── System Prompt Builder (openclaw-style sectioned prompt) ──────────────────

export interface SystemPromptParams {
  /** "full" = all sections (main agent), "minimal" = reduced (subagents), "none" = bare */
  mode?: "full" | "minimal" | "none";
  skillsPrompt?: string;
  workspaceInfo?: string;
  projectContext?: string;
  subagentDepth?: number;
}

export function buildSystemPrompt(params: SystemPromptParams = {}): string {
  const { mode = "full", skillsPrompt, workspaceInfo, projectContext, subagentDepth = 0 } = params;

  if (mode === "none") {
    return "You are Claw Cowork, an AI workspace assistant.";
  }

  const isMinimal = mode === "minimal";
  const sections: string[] = [];

  // ── § Identity ──────────────────────────────────────────────────────────────
  if (!isMinimal) {
    sections.push(
      `## Identity`,
      `You are Claw Cowork, an advanced agentic AI workspace. You have direct access to tools for internet search, file management, code execution, and skill marketplace integration. You act autonomously — plan, execute tools, inspect results, and iterate until the task is complete.`,
      ``
    );
  } else {
    sections.push(
      `## Identity`,
      `You are a Claw Cowork sub-agent (depth ${subagentDepth}). Complete your assigned sub-task using the available tools and return results.`,
      ``
    );
  }

  // ── § Tooling ───────────────────────────────────────────────────────────────
  sections.push(`## Tooling`);

  if (!isMinimal) {
    sections.push(
      `**CRITICAL: Tool Call Format**`,
      `You MUST invoke tools using ONLY the API's built-in tool_calls mechanism.`,
      `NEVER write tool calls as text in your response (no [TOOL_CALL], no <invoke>, no <minimax:tool_call>, no JSON in text).`,
      `If you want to call a tool, call it silently via the API — do NOT mention the syntax in your reply.`,
      ``,
      `Available tools:`,
      `- **web_search**: Search the internet (DuckDuckGo, Google, Wikipedia)`,
      `- **openrouter_web_search**: AI-summarized web search via OpenRouter (best for research)`,
      `- **fetch_url**: Fetch any URL and return its content`,
      `- **run_python**: Execute Python in the sandbox. Working dir is \`output_file/\`. Use \`PROJECT_DIR\` variable for project files`,
      `- **run_react**: Compile and render a React/JSX component in the output panel. Recharts available as global`,
      `- **run_shell**: Execute shell commands (install packages, git, system ops)`,
      `- **read_file**: Read a text file from disk`,
      `- **read_pdf**: Extract text from a PDF file (use this for any uploaded .pdf file)`,
      `- **write_file**: Write or append to a file`,
      `- **list_files**: List directory contents`,
      `- **list_skills**: List all installed ClawHub skills`,
      `- **load_skill**: Load a skill's SKILL.md to learn how to use it`,
      `- **clawhub_search**: Search ClawHub skill marketplace`,
      `- **clawhub_install**: Install a skill from ClawHub`,
      `- **spawn_subagent**: Delegate a sub-task to an independent sub-agent (max depth 3)`,
      `- **MCP tools** (prefix \`mcp_\`): External tools from connected MCP servers`,
      ``
    );
  } else {
    sections.push(
      `Use all available tools to complete your sub-task. Avoid spawning further subagents if possible.`,
      ``
    );
  }

  if (!isMinimal) {
    sections.push(
      `### Tool Rules`,
      `- USE TOOLS actively. When asked to search, call web_search. When asked to fetch, call fetch_url.`,
      `- Do NOT call the same tool with the same arguments more than once. If it returned a result, use it.`,
      `- If a tool fails with "command not found", do NOT retry. Tell the user what needs to be installed.`,
      `- For complex multi-step tasks, use **spawn_subagent** to delegate sub-tasks with clear inputs/outputs.`,
      `- For web research, prefer openrouter_web_search (richer results). Fall back to web_search if unavailable.`,
      `- For interactive UIs, dashboards, or charts — use run_react with Recharts. For data/Python charts — use run_python with matplotlib.`,
      `- CHARTS: Always call plt.savefig('chart.png', dpi=150, bbox_inches='tight'). Never call plt.show(). Use only the filename — NO path prefix.`,
      `- OUTPUT: Python's working dir is already output_file/. Save files with just the filename (e.g. 'report.pdf', 'chart.png'). NEVER prefix paths with 'output_file/' — that creates a wrong nested path.`,
      `- PDF files: When the user uploads a PDF, use read_pdf to extract its text. Never use read_file for PDFs.`,
      `- WORD files: Use python-docx via run_python. Never use write_file for binary formats.`,
      `- REACT: Do NOT use import/export in run_react — React, hooks, and Recharts are globals.`,
      `- MCP tools: Use \`mcp_{server}_{tool}\` when they match the user's request.`,
      ``
    );
  }

  // ── § Workspace ─────────────────────────────────────────────────────────────
  if (workspaceInfo || projectContext) {
    sections.push(`## Workspace`);
    if (workspaceInfo) sections.push(workspaceInfo, ``);
    if (projectContext) sections.push(projectContext, ``);
  }

  // ── § Skills ────────────────────────────────────────────────────────────────
  if (skillsPrompt?.trim()) {
    sections.push(
      `## Skills (mandatory)`,
      `Before replying: scan available_skills descriptions.`,
      `- If exactly one skill clearly applies: read its SKILL.md with load_skill, then follow it.`,
      `- If multiple could apply: choose the most specific one.`,
      `- If none clearly apply: do not read any SKILL.md.`,
      `Constraint: never read more than one skill up front.`,
      skillsPrompt.trim(),
      ``
    );
  }

  // ── § Memory (full mode only) ───────────────────────────────────────────────
  if (!isMinimal) {
    sections.push(
      `## Memory`,
      `If you have access to memory tools: before answering questions about prior work, decisions, or preferences, run memory_search first, then use memory_get for specific lines.`,
      ``
    );
  }

  // ── § Subagent info ─────────────────────────────────────────────────────────
  if (subagentDepth > 0) {
    sections.push(
      `## Subagent Context`,
      `This is a sub-agent at spawn depth ${subagentDepth}. Focus only on the assigned sub-task. Return a clear, complete result.`,
      ``
    );
  }

  return sections.join("\n");
}

// ─── Content-embedded tool call parser ───────────────────────────────────────
// MiniMax and some other models output tool calls as text in content instead
// of using the standard tool_calls API field. This parser handles all known
// formats and strips them from the displayed content.

function parseArrowHash(body: string): Record<string, string> {
  // Parses: { tool => "name", args => { --key "value" ... } }
  // and also: key => "value" pairs
  const args: Record<string, string> = {};
  // --key "value" style
  const flagRe = /--(\w+)\s+"([^"]*)"/g;
  let m;
  while ((m = flagRe.exec(body)) !== null) args[m[1]] = m[2];
  // key => "value" style (skip "tool" and "args" meta-keys)
  const pairRe = /\b(\w+)\s*=>\s*"([^"]*)"/g;
  while ((m = pairRe.exec(body)) !== null) {
    if (m[1] !== "tool" && m[1] !== "args") args[m[1]] = m[2];
  }
  return args;
}

function pushTC(toolCalls: any[], name: string, args: Record<string, any>) {
  toolCalls.push({
    id: `content_tc_${toolCalls.length}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  });
}

function extractContentToolCalls(content: string): {
  toolCalls: any[];
  cleanContent: string;
} {
  const toolCalls: any[] = [];
  let clean = content;

  // Format A: [TOOL_CALL]...[/TOOL_CALL] — handles multiple inner styles
  clean = clean.replace(/\[TOOL_CALL\]([\s\S]*?)\[\/TOOL_CALL\]/g, (_m, body) => {
    // A1: <invoke name="TOOL"><parameter name="k">v</parameter></invoke>  (with closing tags)
    const invokeM = body.match(/<invoke\s+name="(\w+)">([\s\S]*?)(?:<\/invoke>|$)/);
    if (invokeM) {
      const name = invokeM[1];
      const inner = invokeM[2];
      const args: Record<string, string> = {};
      // Try closed <parameter> tags first
      const closedParam = /<parameter\s+name="(\w+)">([\s\S]*?)<\/parameter>/g;
      let pm; let found = false;
      while ((pm = closedParam.exec(inner)) !== null) {
        args[pm[1]] = pm[2].trim().replace(/["}\n\r]+$/, "");
        found = true;
      }
      // Fallback: unclosed <parameter name="k">value (no closing tag)
      if (!found) {
        const openParam = /<parameter\s+name="(\w+)">([\s\S]*?)(?=<parameter|$)/g;
        while ((pm = openParam.exec(inner)) !== null) {
          args[pm[1]] = pm[2].trim().replace(/["}\n\r]+$/, "");
        }
      }
      if (Object.keys(args).length) pushTC(toolCalls, name, args);
      return "";
    }
    // A2: {tool => "name", args => { --key "val" }} style
    const nameM = body.match(/tool\s*=>\s*"(\w+)"/);
    if (nameM) pushTC(toolCalls, nameM[1], parseArrowHash(body));
    return "";
  });

  // Format B: <minimax:tool_call><invoke name="TOOL"><parameter name="k">v</parameter></invoke></minimax:tool_call>
  clean = clean.replace(/<minimax:tool_call>\s*<invoke\s+name="(\w+)">([\s\S]*?)<\/invoke>\s*<\/minimax:tool_call>/g, (_m, name, body) => {
    const args: Record<string, string> = {};
    const paramRe = /<parameter\s+name="(\w+)">([\s\S]*?)<\/parameter>/g;
    let pm;
    while ((pm = paramRe.exec(body)) !== null) args[pm[1]] = pm[2].trim();
    pushTC(toolCalls, name, args);
    return "";
  });

  // Format C: <minimax:tool_call>TOOLNAME{"key":"val"}</minimax:tool_call>
  clean = clean.replace(/<minimax:tool_call>([\s\S]*?)<\/minimax:tool_call>/g, (_m, inner) => {
    const m = inner.trim().match(/^(\w+)\s*(\{[\s\S]*\})/);
    if (m) { try { pushTC(toolCalls, m[1], JSON.parse(m[2])); } catch {} }
    return "";
  });

  // Format D: [minimax:tool_call TOOLNAME{"key":"val"}]}
  clean = clean.replace(/\[minimax:tool_call\s+(\w+)\s*(\{[\s\S]*?\})\s*\][\s}]*/g, (_m, name, argsStr) => {
    try { pushTC(toolCalls, name, JSON.parse(argsStr)); } catch {}
    return "";
  });

  // Format E: <tool_call>{"name":"...","arguments":{...}}</tool_call>
  clean = clean.replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, (_m, inner) => {
    try {
      const obj = JSON.parse(inner.trim());
      if (obj.name) pushTC(toolCalls, obj.name, obj.arguments || obj.args || {});
    } catch {}
    return "";
  });

  // Format F: generic JSON tool call {"name":"...","parameters":{...}} anywhere in content
  clean = clean.replace(/\{"name"\s*:\s*"(\w+)"\s*,\s*"(?:arguments|parameters|args)"\s*:\s*(\{[\s\S]*?\})\}/g, (_m, name, argsStr) => {
    try { pushTC(toolCalls, name, JSON.parse(argsStr)); } catch {}
    return "";
  });

  if (toolCalls.length === 0 && content.length > 0) {
    console.log(`[extractContentToolCalls] No match. Raw content: ${JSON.stringify(content.slice(0, 500))}`);
  }

  return { toolCalls, cleanContent: clean.trim() };
}

// Strip any leaked tool call markers from final response content
function stripToolCallMarkers(content: string): string {
  return content
    .replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, "")
    .replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/\[minimax:tool_call[\s\S]*?\]/g, "")
    .trim();
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

export async function runAgentLoop(
  messages: ChatMessage[],
  systemPrompt: string,
  options: {
    onToolCall?: (name: string, args: any) => void;
    onToolResult?: (name: string, result: any) => void;
    allowedTools?: string[];
    subagentDepth?: number;
  } = {}
): Promise<AgentResponse> {
  const { onToolCall, onToolResult, allowedTools, subagentDepth = 0 } = options;

  const { apiKey } = getApiConfig();
  if (!apiKey) {
    return { content: "API key not configured. Go to Settings to add your API key." };
  }

  const allMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const settings = getSettings();
  const maxToolRounds = settings.agentMaxToolRounds ?? 8;
  const maxToolCalls = settings.agentMaxToolCalls ?? 12;
  const toolResults: Array<{ tool: string; result: any }> = [];
  const toolCallHistory: string[] = [];
  let totalToolCalls = 0;
  let consecutiveErrors = 0;
  let lastUsage: any;
  let earlyContent: string | null = null;

  // Filter tools if allowedTools is set (for subagents)
  const allTools = getTools(subagentDepth);
  const tools = allowedTools
    ? allTools.filter((t) => allowedTools.includes(t.function.name))
    : allTools;

  // ── Main tool loop ──────────────────────────────────────────────────────────
  for (let round = 0; round < maxToolRounds; round++) {
    let data: any;
    try {
      data = await llmCall(allMessages, { tools });
    } catch (err: any) {
      return { content: `Connection error: ${err.message}`, toolResults };
    }

    const choice = data.choices?.[0];
    if (!choice) {
      console.log(`[AgentLoop] No choices at round ${round}:`, JSON.stringify(data).slice(0, 500));
      break;
    }

    const message = choice.message;
    let toolCalls = message.tool_calls || [];
    lastUsage = data.usage;

    // MiniMax (and some other models) embed tool calls as text in content
    // instead of using the proper tool_calls field. Parse and extract them.
    if (!toolCalls.length && message.content) {
      const extracted = extractContentToolCalls(message.content);
      if (extracted.toolCalls.length) {
        toolCalls = extracted.toolCalls;
        message.content = extracted.cleanContent;
      }
    }

    // Truncate large tool_call args to prevent context overflow
    const truncatedToolCalls = toolCalls.length
      ? toolCalls.map((tc: any) => {
          const args = tc.function?.arguments || "";
          const argsStr = typeof args === "string" ? args : JSON.stringify(args);
          return argsStr.length > 4000
            ? { ...tc, function: { ...tc.function, arguments: argsStr.slice(0, 4000) + "..." } }
            : tc;
        })
      : undefined;

    allMessages.push({
      role: "assistant",
      content: message.content || "",
      tool_calls: truncatedToolCalls,
    });

    if (!toolCalls.length) {
      earlyContent = stripToolCallMarkers(message.content || "No response generated.");
      break;
    }

    // Loop detection: same tool+args 3 rounds in a row → break
    const signature = toolCalls
      .map((tc: any) => {
        const name = tc.function?.name || "";
        const args = typeof tc.function?.arguments === "string"
          ? tc.function.arguments.slice(0, 100)
          : JSON.stringify(tc.function?.arguments || {}).slice(0, 100);
        return `${name}:${args}`;
      })
      .sort()
      .join("|");
    toolCallHistory.push(signature);
    if (toolCallHistory.length >= 3) {
      const last3 = toolCallHistory.slice(-3);
      if (last3[0] === last3[1] && last3[1] === last3[2]) {
        console.log(`[AgentLoop] Loop detected. Breaking.`);
        break;
      }
    }

    // Execute each tool call
    for (const tc of toolCalls) {
      const fnName: string = tc.function?.name || "";
      let fnArgs: any = {};
      const rawArgs = tc.function?.arguments || "{}";
      try {
        fnArgs = typeof rawArgs === "object" ? rawArgs : JSON.parse(rawArgs);
      } catch (parseErr: any) {
        console.error(`[Tool ${fnName}] JSON parse failed:`, parseErr.message);
        // Try to recover code for run_python / run_react
        if (fnName === "run_python" || fnName === "run_react") {
          const codeKey = rawArgs.indexOf('"code"');
          if (codeKey !== -1) {
            const valueStart = rawArgs.indexOf('"', codeKey + 6) + 1;
            if (valueStart > 0) {
              let valueEnd = rawArgs.lastIndexOf('"');
              for (const tk of ['"title"', '"dependencies"']) {
                const tkPos = rawArgs.lastIndexOf(tk);
                if (tkPos > valueStart) {
                  const commaPos = rawArgs.lastIndexOf(",", tkPos);
                  if (commaPos > valueStart) {
                    const qPos = rawArgs.lastIndexOf('"', commaPos - 1);
                    if (qPos > valueStart) valueEnd = qPos;
                  }
                }
              }
              if (valueEnd > valueStart) {
                const codeValue = rawArgs
                  .slice(valueStart, valueEnd)
                  .replace(/\\n/g, "\n")
                  .replace(/\\t/g, "\t")
                  .replace(/\\"/g, '"')
                  .replace(/\\\\/g, "\\");
                fnArgs = { code: codeValue };
                const titleMatch = rawArgs.match(/"title"\s*:\s*"([^"]*)"/);
                if (titleMatch) fnArgs.title = titleMatch[1];
              }
            }
          }
        }
      }

      console.log(
        `[Tool ${fnName}] args:`,
        Object.keys(fnArgs),
        fnArgs.code
          ? `code(${fnArgs.code.length})`
          : fnArgs.command || fnArgs.query || fnArgs.skill || fnArgs.path || ""
      );

      if (onToolCall) onToolCall(fnName, fnArgs);

      let result: any;
      try {
        result = await callTool(fnName, fnArgs, subagentDepth);
      } catch (err: any) {
        result = { ok: false, error: err.message };
      }

      // Consecutive error tracking (adopted from openclaw tool policy)
      if (result?.ok === false || result?.exitCode === 1) {
        consecutiveErrors++;
        console.log(
          `[Tool ${fnName}] Error (${consecutiveErrors} consecutive):`,
          result?.error || result?.stderr || ""
        );
      } else {
        consecutiveErrors = 0;
      }

      if (onToolResult) onToolResult(fnName, result);
      toolResults.push({ tool: fnName, result });
      totalToolCalls++;

      // Truncate large results to prevent context overflow
      let resultStr = JSON.stringify(result);
      const baseMaxLen = settings.agentToolResultMaxLen ?? 6000;
      const maxLen = fnName === "load_skill" ? Math.min(3000, baseMaxLen) : baseMaxLen;
      if (resultStr.length > maxLen) resultStr = resultStr.slice(0, maxLen) + "\n...(truncated)";

      allMessages.push({ role: "tool", content: resultStr, tool_call_id: tc.id });

      const maxConsErr = settings.agentMaxConsecutiveErrors ?? 3;
      if (consecutiveErrors >= maxConsErr) {
        console.log(`[AgentLoop] ${maxConsErr} consecutive errors. Breaking.`);
        break;
      }
      if (totalToolCalls >= maxToolCalls) break;
    }

    if (
      totalToolCalls >= maxToolCalls ||
      consecutiveErrors >= (settings.agentMaxConsecutiveErrors ?? 3)
    )
      break;
  }

  console.log(`[AgentLoop] Completed: ${totalToolCalls} tool calls.`);

  // Direct return if no tools were called
  if (earlyContent && totalToolCalls === 0) {
    return { content: earlyContent, usage: lastUsage, toolResults };
  }

  // ── Reflection loop (openclaw-inspired: evaluate → re-enter if gaps found) ──
  const reflectionEnabled = settings.agentReflectionEnabled ?? false;
  const evalThreshold = settings.agentEvalThreshold ?? 0.7;
  const maxReflectionRetries = settings.agentMaxReflectionRetries ?? 2;

  if (reflectionEnabled && totalToolCalls > 0) {
    try {
      const userObjective = allMessages
        .filter((m) => m.role === "user")
        .map((m) => (typeof m.content === "string" ? m.content : (m.content as any[]).map((p: any) => p.text || "").join(" ")))
        .join("\n");

      for (let retry = 0; retry < maxReflectionRetries; retry++) {
        const toolSummaryForEval = toolResults
          .map((tr) => {
            const r = tr.result;
            if (r?.outputFiles?.length) return `[${tr.tool}] Generated: ${r.outputFiles.join(", ")}`;
            if (r?.ok === false) return `[${tr.tool}] Error: ${r.error || "failed"}`;
            if (r?.stdout) return `[${tr.tool}] ${r.stdout.slice(0, 300)}`;
            return `[${tr.tool}] ${JSON.stringify(r).slice(0, 300)}`;
          })
          .join("\n");

        const evalMessages: ChatMessage[] = [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `You are an evaluation judge. Score how well the agent satisfied the user's objective.

USER OBJECTIVE:
${userObjective}

AGENT ACTIONS (${totalToolCalls} tool calls):
${toolSummaryForEval}

LAST ASSISTANT MESSAGE:
${allMessages.filter((m) => m.role === "assistant").pop()?.content || "(none)"}

Respond in EXACTLY this JSON format (no other text):
{"score": <0.0-1.0>, "satisfied": <true/false>, "missing": "<gaps or empty string if satisfied>"}

Scoring: 1.0=fully satisfied, 0.7-0.9=minor gaps, 0.4-0.6=significant gaps, 0.0-0.3=not satisfied`,
          },
        ];

        const evalData = await llmCall(evalMessages);
        const evalContent = evalData.choices?.[0]?.message?.content || "";
        const jsonMatch = evalContent.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
        if (!jsonMatch) break;

        const evalResult = JSON.parse(jsonMatch[0]);
        const score = parseFloat(evalResult.score) || 0;
        const satisfied = evalResult.satisfied === true;
        const missing = evalResult.missing || "";

        console.log(`[Reflection] Round ${retry + 1}: score=${score}, satisfied=${satisfied}`);

        if (score >= evalThreshold || satisfied) break;

        // Re-enter agent loop to address gaps
        allMessages.push({
          role: "system",
          content: `REFLECTION: Score ${score}/1.0 (threshold ${evalThreshold}). Gaps: ${missing}\n\nPlease address what is missing to fully satisfy the user's objective.`,
        });

        const retryMaxRounds = Math.min(maxToolRounds, 5);
        for (let round = 0; round < retryMaxRounds; round++) {
          let data: any;
          try {
            data = await llmCall(allMessages, { tools });
          } catch {
            break;
          }
          const choice = data.choices?.[0];
          if (!choice) break;
          const msg = choice.message;
          const retryTCs = msg.tool_calls || [];
          allMessages.push({
            role: "assistant",
            content: msg.content || "",
            tool_calls: retryTCs.length ? retryTCs : undefined,
          });
          if (!retryTCs.length) break;
          for (const tc of retryTCs) {
            const fnName: string = tc.function?.name || "";
            let fnArgs: any = {};
            try {
              fnArgs = JSON.parse(tc.function?.arguments || "{}");
            } catch {}
            if (onToolCall) onToolCall(fnName, fnArgs);
            let result: any;
            try {
              result = await callTool(fnName, fnArgs, subagentDepth);
            } catch (err: any) {
              result = { ok: false, error: err.message };
            }
            if (onToolResult) onToolResult(fnName, result);
            toolResults.push({ tool: fnName, result });
            totalToolCalls++;
            let rs = JSON.stringify(result);
            if (rs.length > 6000) rs = rs.slice(0, 6000) + "\n...(truncated)";
            allMessages.push({ role: "tool", content: rs, tool_call_id: tc.id });
          }
        }
      }
    } catch (err: any) {
      console.error(`[Reflection] Error:`, err.message);
    }
  }

  // If we already have a good final answer from the agent, return it directly.
  // Skip the extra final-summary LLM call — it adds latency without value.
  if (earlyContent) {
    return { content: earlyContent, usage: lastUsage, toolResults };
  }

  // ── Nudge loop: if user wanted charts but none generated ──────────────────
  const hasOutputFiles = toolResults.some((tr) => tr.result?.outputFiles?.length > 0);
  const userWantsOutput = allMessages.some((m) => {
    if (m.role !== "user") return false;
    const text = typeof m.content === "string"
      ? m.content
      : (m.content as any[]).map((p: any) => p.text || "").join(" ");
    return /\b(chart|graph|plot|report|analy[sz]|visual|diagram|figure)\b/i.test(text);
  });

  if (userWantsOutput && !hasOutputFiles && totalToolCalls > 0) {
    const errors = toolResults
      .filter((tr) => tr.result?.exitCode === 1 || tr.result?.ok === false)
      .map((tr) => tr.result?.stderr || tr.result?.error || "")
      .filter(Boolean)
      .join("\n");

    allMessages.push({
      role: "system",
      content: `IMPORTANT: The user asked for charts/graphs but you have not generated any output files yet. Call run_python to create matplotlib charts and save as PNG. Use plt.savefig('filename.png', dpi=150, bbox_inches='tight').${errors ? `\n\nPrevious errors:\n${errors.slice(0, 800)}` : ""}`,
    });

    for (let nudge = 0; nudge < 3; nudge++) {
      try {
        const nudgeData = await llmCall(allMessages, { tools });
        const nudgeChoice = nudgeData.choices?.[0];
        if (!nudgeChoice?.message?.tool_calls?.length) {
          if (nudgeChoice?.message?.content) {
            return { content: nudgeChoice.message.content, usage: nudgeData.usage, toolResults };
          }
          break;
        }
        const nudgeMsg = nudgeChoice.message;
        allMessages.push({
          role: "assistant",
          content: nudgeMsg.content || "",
          tool_calls: nudgeMsg.tool_calls,
        });
        let nudgeHasOutput = false;
        for (const tc of nudgeMsg.tool_calls) {
          const fnName: string = tc.function?.name || "";
          let fnArgs: any = {};
          try { fnArgs = JSON.parse(tc.function?.arguments || "{}"); } catch {}
          if (onToolCall) onToolCall(fnName, fnArgs);
          let result: any;
          try { result = await callTool(fnName, fnArgs, subagentDepth); } catch (err: any) { result = { ok: false, error: err.message }; }
          if (onToolResult) onToolResult(fnName, result);
          toolResults.push({ tool: fnName, result });
          totalToolCalls++;
          if (result?.outputFiles?.length > 0) nudgeHasOutput = true;
          let rs = JSON.stringify(result);
          if (rs.length > 6000) rs = rs.slice(0, 6000) + "\n...(truncated)";
          allMessages.push({ role: "tool", content: rs, tool_call_id: tc.id });
        }
        if (nudgeHasOutput) break;
      } catch (err: any) {
        console.error("[NudgeLoop] Failed:", err.message);
        break;
      }
    }
  }

  // ── Final summary response ────────────────────────────────────────────────
  const toolSummary = toolResults
    .map((tr) => {
      try {
        const r = tr.result;
        if (r?.outputFiles?.length > 0) return `[${tr.tool}] Generated: ${r.outputFiles.join(", ")}`;
        if (r?.ok === false) return `[${tr.tool}] Error: ${r.error || "failed"}`;
        if (r?.stdout) return `[${tr.tool}] ${r.stdout.slice(0, 300)}`;
        if (typeof r === "string") return `[${tr.tool}] ${r.slice(0, 300)}`;
        return `[${tr.tool}] ${JSON.stringify(r).slice(0, 300)}`;
      } catch { return `[${tr.tool}] (unavailable)`; }
    })
    .join("\n");

  const finalMessages: ChatMessage[] = [];
  for (const m of allMessages) {
    if (m.role === "system" && finalMessages.length === 0) finalMessages.push(m);
    else if (m.role === "user") finalMessages.push(m);
  }
  finalMessages.push({
    role: "system",
    content: `You executed ${totalToolCalls} tool calls. Summary:\n${toolSummary}\n\nProvide a clear, helpful final response. Mention generated files. Do NOT call tools.`,
  });

  try {
    const data = await llmCall(finalMessages);
    const content = stripToolCallMarkers(data.choices?.[0]?.message?.content || "");
    if (content) return { content, usage: data.usage, toolResults };
  } catch (err: any) {
    console.error("[FinalResponse] Failed:", err.message);
  }

  // Fallback
  const outputFiles = toolResults.flatMap((tr) => tr.result?.outputFiles || []);
  const stdouts = toolResults.filter((tr) => tr.result?.stdout).map((tr) => tr.result.stdout.slice(0, 500));
  let fallback = "";
  if (outputFiles.length > 0) fallback += `Generated ${outputFiles.length} file(s): ${outputFiles.join(", ")}\n\n`;
  if (stdouts.length > 0) fallback += stdouts.join("\n---\n").slice(0, 3000);
  return { content: fallback || "Task completed. Check the output panel for results.", toolResults };
}

// ─── Subagent Runner (openclaw subagent pattern) ─────────────────────────────

const MAX_SUBAGENT_DEPTH = 3;

export async function runSubagent(params: {
  task: string;
  context?: string;
  allowedTools?: string[];
  parentDepth: number;
  onToolCall?: (name: string, args: any) => void;
  onToolResult?: (name: string, result: any) => void;
}): Promise<AgentResponse> {
  const { task, context, allowedTools, parentDepth, onToolCall, onToolResult } = params;
  const depth = parentDepth + 1;

  if (depth > MAX_SUBAGENT_DEPTH) {
    return { content: `[Subagent error] Max subagent depth (${MAX_SUBAGENT_DEPTH}) reached.` };
  }

  console.log(`[Subagent] Spawning at depth ${depth}: "${task.slice(0, 80)}"`);

  const subPrompt = buildSystemPrompt({
    mode: "minimal",
    workspaceInfo: context,
    subagentDepth: depth,
  });

  return runAgentLoop(
    [{ role: "user", content: task }],
    subPrompt,
    { onToolCall, onToolResult, allowedTools, subagentDepth: depth }
  );
}

// ─── Simple call (no tools, backwards compat) ─────────────────────────────────

export async function callAgent(
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<AgentResponse> {
  const { apiKey } = getApiConfig();
  if (!apiKey) return { content: "API key not configured. Go to Settings to add your API key." };

  const allMessages: ChatMessage[] = [];
  if (systemPrompt) allMessages.push({ role: "system", content: systemPrompt });
  allMessages.push(...messages);

  try {
    const data = await llmCall(allMessages);
    return {
      content: data.choices?.[0]?.message?.content || "No response.",
      usage: data.usage,
    };
  } catch (err: any) {
    return { content: `Connection error: ${err.message}` };
  }
}
