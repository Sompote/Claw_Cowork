/**
 * Claw Cowork Toolbox
 *
 * Built-in tool definitions + dispatcher.
 * Adopts openclaw's tool policy: access control per project folder settings.
 * Adds spawn_subagent tool for openclaw-style subagent delegation.
 */

import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { runPython } from "./python";
import { getSettings, getProjects } from "./data";
import { getMcpTools, callMcpTool, isMcpTool } from "./mcp";
import { runSubagent } from "./agent";

// ─── Tool Policy (openclaw-style access control) ───────────────────────────

function getProjectAccessForPath(
  filePath: string
): { inProject: boolean; access: "readonly" | "readwrite" | "full"; projectName?: string } {
  const resolved = path.resolve(filePath);
  const projects = getProjects();
  for (const p of projects) {
    if (!p.workingFolder) continue;
    const projectDir = path.resolve(p.workingFolder);
    if (resolved === projectDir || resolved.startsWith(projectDir + path.sep)) {
      if (p.folderLocation !== "external") {
        return { inProject: true, access: "full", projectName: p.name };
      }
      return { inProject: true, access: p.folderAccess || "readwrite", projectName: p.name };
    }
  }
  return { inProject: false, access: "readwrite" };
}

function assertWriteAccess(filePath: string): void {
  const { inProject, access, projectName } = getProjectAccessForPath(filePath);
  if (inProject && access === "readonly") {
    throw new Error(`Write denied: project "${projectName}" folder is read-only`);
  }
}

function assertFullAccess(dirPath: string): void {
  const { inProject, access, projectName } = getProjectAccessForPath(dirPath);
  if (inProject && access === "readonly") {
    throw new Error(`Shell access denied: project "${projectName}" folder is read-only`);
  }
  if (inProject && access === "readwrite") {
    throw new Error(`Shell access denied: project "${projectName}" folder is read-write only (no exec). Change to "full" in project settings.`);
  }
}

const execAsync = promisify(exec);

// ─── Tool Definitions (OpenAI function-calling format) ─────────────────────

const builtinTools = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description: "Search the web using DuckDuckGo and Wikipedia. Returns results with titles, URLs, and snippets.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search query" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "fetch_url",
      description: "Fetch content from a URL. Returns the response body.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
          method: { type: "string", description: "HTTP method (default GET)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_python",
      description: "Execute Python code in the sandbox. Working dir is already output_file/ — save files with just the filename (e.g. 'report.pdf'), never prefix with 'output_file/'. Use PROJECT_DIR to access uploaded/project files. Returns stdout, stderr, and output files.",
      parameters: {
        type: "object",
        properties: { code: { type: "string", description: "Python code to execute" } },
        required: ["code"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_react",
      description: "Compile and render a React/JSX component in the output panel. Recharts (LineChart, BarChart, PieChart, etc.) and React hooks are available as globals. Do NOT use import statements.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "React JSX component code (no imports needed)" },
          title: { type: "string", description: "Page title (optional)" },
          dependencies: { type: "array", items: { type: "string" }, description: "Additional CDN libraries" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_shell",
      description: "Execute a shell command. Use for installing packages, git operations, system tasks.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
          cwd: { type: "string", description: "Working directory (optional)" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a file from disk. Returns content (truncated if large).",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "File path to read" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_pdf",
      description: "Extract text content from a PDF file. Use this when the user uploads a PDF or asks you to analyze a PDF document. Returns the text content and page count.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path to the PDF file (absolute or relative to sandbox/uploads/)" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Write or append content to a file on disk.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "Content to write" },
          append: { type: "boolean", description: "Append instead of overwrite" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description: "List files and directories at a path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path" },
          recursive: { type: "boolean", description: "List recursively" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_skills",
      description: "List all installed ClawHub skills available for use.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "load_skill",
      description: "Load a skill's SKILL.md instructions. Use this before executing a skill.",
      parameters: {
        type: "object",
        properties: { skill: { type: "string", description: "Skill name/slug" } },
        required: ["skill"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "clawhub_search",
      description: "Search the ClawHub skill marketplace.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "integer", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "clawhub_install",
      description: "Install a skill from ClawHub by slug.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Skill slug to install" },
          force: { type: "boolean", description: "Force reinstall" },
        },
        required: ["slug"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "spawn_subagent",
      description: "Delegate a complex sub-task to an independent sub-agent. The sub-agent has its own tool loop and returns a result. Use for parallelizable or specialized tasks. Max depth: 3.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Complete description of the sub-task to perform" },
          context: { type: "string", description: "Additional context the sub-agent needs" },
          allowed_tools: {
            type: "array",
            items: { type: "string" },
            description: "Restrict which tools the sub-agent can use (optional, default: all except spawn_subagent)",
          },
        },
        required: ["task"],
      },
    },
  },
];

// OpenRouter Web Search tool (conditionally included)
const openRouterSearchTool = {
  type: "function" as const,
  function: {
    name: "openrouter_web_search",
    description: "Search the web via OpenRouter's AI-powered search. Returns summarized results with citations. Best for detailed, up-to-date answers.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
};

/**
 * Get all available tool definitions.
 * subagentDepth > 0 removes spawn_subagent to prevent deep nesting.
 */
export function getTools(subagentDepth = 0) {
  const settings = getSettings();
  let tools = [...builtinTools];

  // Remove spawn_subagent for subagents (openclaw depth-limit pattern)
  if (subagentDepth > 0) {
    tools = tools.filter((t) => t.function.name !== "spawn_subagent");
  }

  if (settings.openRouterSearchEnabled && settings.openRouterSearchApiKey) {
    tools.push(openRouterSearchTool);
  }

  return [...tools, ...getMcpTools()];
}

export const tools = builtinTools;

// ─── Tool Implementations ──────────────────────────────────────────────────

async function webSearch(args: { query: string }): Promise<any> {
  const settings = getSettings();
  const results: any[] = [];

  // DuckDuckGo Instant Answer
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_html=1`
    );
    const ddg = await res.json();
    if (ddg.Abstract) {
      results.push({ source: "abstract", title: ddg.Heading, text: ddg.Abstract, url: ddg.AbstractURL });
    }
    for (const t of (ddg.RelatedTopics || []).slice(0, 8)) {
      if (t.Text) results.push({ source: "related", text: t.Text, url: t.FirstURL });
    }
  } catch {}

  // DuckDuckGo HTML search
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`,
      { headers: { "User-Agent": "ClawCowork/1.0" } }
    );
    const html = await res.text();
    const matches = [
      ...html.matchAll(
        /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
      ),
    ];
    for (const m of matches.slice(0, 8)) {
      results.push({
        source: "web",
        url: m[1],
        title: m[2].replace(/<[^>]+>/g, "").trim(),
        text: m[3].replace(/<[^>]+>/g, "").trim(),
      });
    }
  } catch {}

  // Google (if configured)
  if (settings.webSearchEngine === "google" && settings.webSearchApiKey) {
    try {
      const cx = settings.googleSearchCx || "";
      const gRes = await fetch(
        `https://www.googleapis.com/customsearch/v1?key=${settings.webSearchApiKey}&cx=${cx}&q=${encodeURIComponent(args.query)}`
      );
      const gData = await gRes.json();
      for (const item of (gData.items || []).slice(0, 5)) {
        results.push({ source: "google", title: item.title, url: item.link, text: item.snippet });
      }
    } catch {}
  }

  // Wikipedia
  try {
    const wRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(args.query)}&srlimit=3`,
      { headers: { "User-Agent": "ClawCowork/1.0" } }
    );
    const wData = await wRes.json();
    for (const item of wData.query?.search || []) {
      results.push({
        source: "wikipedia",
        title: item.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
        text: item.snippet?.replace(/<[^>]+>/g, "") || "",
      });
    }
  } catch {}

  if (!results.length) {
    return { results: [], note: "No results found. Try a different query or use fetch_url." };
  }
  return { results };
}

async function fetchUrl(args: { url: string; method?: string }): Promise<any> {
  try {
    const response = await fetch(args.url, {
      method: args.method || "GET",
      headers: { "User-Agent": "ClawCowork/1.0" },
    });
    const contentType = response.headers.get("content-type") || "";
    let data: any;
    if (contentType.includes("json")) {
      data = await response.json();
    } else {
      data = await response.text();
      if (typeof data === "string" && data.length > 30000) {
        data = data.slice(0, 30000) + "\n...(truncated)";
      }
    }
    return { ok: response.ok, status: response.status, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

async function runPythonTool(args: { code: string }): Promise<any> {
  const settings = getSettings();
  const sandboxDir = settings.sandboxDir || path.resolve("sandbox");
  const result = await runPython(args.code, sandboxDir, 60000);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.slice(0, 20000),
    stderr: result.stderr.slice(0, 5000),
    outputFiles: result.outputFiles,
  };
}

async function runReactTool(args: { code: string; title?: string; dependencies?: string[] }): Promise<any> {
  const settings = getSettings();
  const sandboxDir = settings.sandboxDir || path.resolve("sandbox");
  const outputDir = path.join(sandboxDir, "output_file");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  let code = args.code || "";
  // Strip import statements — React/Recharts are injected at runtime
  code = code.replace(/^\s*import\s+.*?\s+from\s+['"][^'"]+['"];?\s*$/gm, "");
  code = code.replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, "");

  // Detect exported component name
  let exportedComponent = "";
  const exportDefaultFuncMatch = code.match(/export\s+default\s+function\s+(\w+)/);
  if (exportDefaultFuncMatch) {
    exportedComponent = exportDefaultFuncMatch[1];
  } else {
    const exportDefaultMatch = code.match(/export\s+default\s+(\w+)\s*;?/);
    if (exportDefaultMatch) exportedComponent = exportDefaultMatch[1];
  }

  code = code.replace(/export\s+default\s+(function|class)\s+/g, "$1 ");
  code = code.replace(/^\s*export\s+default\s+\w+\s*;?\s*$/gm, "");
  code = code.replace(/^\s*export\s+/gm, "");

  const componentMatches = code.match(/(?:function|const|class)\s+([A-Z]\w+)/g) || [];
  const componentNames = componentMatches.map((m) => m.replace(/^(?:function|const|class)\s+/, ""));
  const renderTarget =
    exportedComponent ||
    componentNames.find((n) => n === "App") ||
    componentNames[componentNames.length - 1] ||
    "";

  const wrapped = `const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext, Fragment, memo, forwardRef, lazy, Suspense } = React;
const _Recharts = typeof Recharts !== 'undefined' ? Recharts : {};
const { LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ComposedChart, Treemap, Funnel, FunnelChart, RadialBarChart, RadialBar, Sankey, LabelList, Brush, ReferenceLine, ReferenceArea, ReferenceDot, ErrorBar, Label } = _Recharts;

${code}

return ${renderTarget || "null"};`;

  let compiled: string;
  try {
    const esbuild = await import("esbuild");
    const result = await esbuild.transform(wrapped, {
      loader: "jsx",
      jsx: "transform",
      jsxFactory: "React.createElement",
      jsxFragment: "React.Fragment",
    });
    compiled = result.code;
  } catch (err: any) {
    return { ok: false, error: `JSX compilation failed: ${err.message}`, outputFiles: [] };
  }

  const filename = `react_${Date.now()}.jsx.js`;
  const filePath = path.join(outputDir, filename);
  const meta = JSON.stringify({ title: args.title || "React Component", renderTarget });
  const output = `// __REACT_META__=${meta}\n${compiled}`;

  try {
    fs.writeFileSync(filePath, output, "utf8");
    const relPath = `output_file/${filename}`;
    return {
      ok: true,
      outputFiles: [relPath],
      message: `React component compiled to ${relPath}. It will render in the output panel.`,
    };
  } catch (err: any) {
    return { ok: false, error: err.message, outputFiles: [] };
  }
}

async function runShell(args: { command?: string; cmd?: string; cwd?: string }): Promise<any> {
  const command = args.command || args.cmd;
  if (!command) return { ok: false, error: "No command provided" };
  const settings = getSettings();
  const cwd = args.cwd || settings.sandboxDir || process.cwd();
  try { assertFullAccess(cwd); } catch (err: any) { return { ok: false, error: err.message }; }
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout).slice(0, 20000), stderr: String(stderr).slice(0, 5000) };
  } catch (err: any) {
    return {
      ok: false,
      error: err.message,
      stdout: String(err.stdout || "").slice(0, 10000),
      stderr: String(err.stderr || "").slice(0, 5000),
    };
  }
}

function readFileTool(args: { path?: string; file?: string; filepath?: string }): any {
  const filePath = args.path || args.file || args.filepath;
  if (!filePath) return { ok: false, error: "No path provided" };
  const target = path.resolve(filePath);
  if (!fs.existsSync(target)) return { ok: false, error: "File not found: " + target };
  const content = fs.readFileSync(target, "utf8");
  return { ok: true, path: target, content: content.slice(0, 30000), truncated: content.length > 30000 };
}

async function readPdfTool(args: { path?: string; file?: string; filepath?: string }): Promise<any> {
  const filePath = args.path || args.file || args.filepath;
  if (!filePath) return { ok: false, error: "No path provided" };
  const settings = getSettings();
  const sandboxDir = settings.sandboxDir || path.resolve("sandbox");
  // Try absolute, then relative to sandbox
  let target = path.resolve(filePath);
  if (!fs.existsSync(target)) {
    target = path.join(sandboxDir, filePath);
  }
  if (!fs.existsSync(target)) return { ok: false, error: "File not found: " + filePath };
  try {
    // @ts-ignore
    const pdfParse = (await import("pdf-parse")).default;
    const buffer = fs.readFileSync(target);
    const data = await pdfParse(buffer);
    const text = data.text || "";
    return { ok: true, text: text.slice(0, 30000), pages: data.numpages, truncated: text.length > 30000 };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

function writeFileTool(args: { path: string; content: string; append?: boolean }): any {
  const settings = getSettings();
  const sandboxDir = settings.sandboxDir || path.resolve("sandbox");
  const outputDir = path.join(sandboxDir, "output_file");
  const target = path.resolve(outputDir, args.path);
  try { assertWriteAccess(target); } catch (err: any) { return { ok: false, error: err.message }; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (args.append) {
    fs.appendFileSync(target, args.content, "utf8");
  } else {
    fs.writeFileSync(target, args.content, "utf8");
  }
  const ext = path.extname(args.path).toLowerCase();
  const outputExts = [".pdf", ".docx", ".doc", ".xlsx", ".csv", ".png", ".jpg", ".jpeg", ".svg", ".html", ".gif", ".webp"];
  const relPath = path.relative(sandboxDir, target);
  const outputFiles = outputExts.includes(ext) ? [relPath] : [];
  return { ok: true, path: target, bytes: Buffer.byteLength(args.content), outputFiles };
}

function listFilesTool(args: { path?: string; recursive?: boolean }): any {
  const settings = getSettings();
  const target = path.resolve(args.path || settings.sandboxDir || ".");
  if (!fs.existsSync(target)) return { ok: false, error: "Directory not found" };
  const items: { path: string; type: string }[] = [];
  const limit = 200;
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (items.length >= limit) return;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      items.push({ path: full, type: entry.isDirectory() ? "dir" : "file" });
      if (args.recursive && entry.isDirectory()) walk(full);
    }
  }
  walk(target);
  return { root: target, items, truncated: items.length >= limit };
}

const SKILLS_DIR = path.resolve("ClawCowork_skills");

function listSkillsTool(): any {
  const clawhubSkills: string[] = [];
  if (fs.existsSync(SKILLS_DIR)) {
    const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const d of dirs) {
      if (d.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, d.name, "SKILL.md"))) {
        clawhubSkills.push(d.name);
      }
    }
  }
  let builtinSkills: string[] = [];
  try {
    const skillsFile = path.resolve("data/skills.json");
    if (fs.existsSync(skillsFile)) {
      const skills = JSON.parse(fs.readFileSync(skillsFile, "utf8"));
      builtinSkills = skills.filter((s: any) => s.enabled).map((s: any) => s.name);
    }
  } catch {}
  return {
    clawhub_skills: clawhubSkills,
    builtin_skills: builtinSkills,
    skills_dir: SKILLS_DIR,
    hint: "Use load_skill with a skill name to read its SKILL.md instructions.",
  };
}

function loadSkillTool(args: { skill: string }): any {
  const skillName = args.skill.trim();
  if (!skillName) return { ok: false, error: "Missing skill name" };
  const skillFile = path.join(SKILLS_DIR, skillName, "SKILL.md");
  const skillBaseDir = path.join(SKILLS_DIR, skillName);
  if (fs.existsSync(skillFile)) {
    const content = fs.readFileSync(skillFile, "utf8").replace(/\{baseDir\}/g, skillBaseDir);
    let meta: any = {};
    const metaFile = path.join(SKILLS_DIR, skillName, "_meta.json");
    if (fs.existsSync(metaFile)) {
      try { meta = JSON.parse(fs.readFileSync(metaFile, "utf8")); } catch {}
    }
    return { ok: true, skill: skillName, content: content.slice(0, 15000), meta, truncated: content.length > 15000 };
  }
  return { ok: false, error: `Skill "${skillName}" not found in ${SKILLS_DIR}` };
}

async function clawhubSearchTool(args: { query: string; limit?: number }): Promise<any> {
  const { execFile } = await import("child_process");
  const { promisify: prom } = await import("util");
  const execFileAsync = prom(execFile);
  const candidates = [path.resolve("ClawCowork_skills/node_modules/.bin/clawhub"), "clawhub"];
  let bin = "";
  for (const b of candidates) {
    try { await execFileAsync(b, ["--cli-version"], { timeout: 5000 }); bin = b; break; } catch {}
  }
  if (!bin) return { ok: false, error: "clawhub CLI not found" };
  const limit = Math.min(50, Math.max(1, args.limit || 10));
  const workdir = path.resolve("ClawCowork_skills");
  try {
    const { stdout, stderr } = await execFileAsync(
      bin,
      ["search", args.query, "--limit", String(limit), "--no-input", "--workdir", workdir, "--dir", "skills"],
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    return { ok: true, output: stdout.trim(), warning: stderr.trim() };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

async function clawhubInstallTool(args: { slug: string; force?: boolean }): Promise<any> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.slug)) {
    return { ok: false, error: "Invalid slug format" };
  }
  const { execFile } = await import("child_process");
  const { promisify: prom } = await import("util");
  const execFileAsync = prom(execFile);
  const candidates = [path.resolve("ClawCowork_skills/node_modules/.bin/clawhub"), "clawhub"];
  let bin = "";
  for (const b of candidates) {
    try { await execFileAsync(b, ["--cli-version"], { timeout: 5000 }); bin = b; break; } catch {}
  }
  if (!bin) return { ok: false, error: "clawhub CLI not found" };
  const workdir = path.resolve("ClawCowork_skills");
  const argv = ["install", args.slug, "--no-input", "--workdir", workdir, "--dir", "skills"];
  if (args.force) argv.push("--force");
  try {
    const { stdout, stderr } = await execFileAsync(bin, argv, { timeout: 120000, maxBuffer: 1024 * 1024 });
    return { ok: true, slug: args.slug, output: stdout.trim(), warning: stderr.trim() };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

async function openRouterWebSearch(args: { query: string }): Promise<any> {
  const settings = getSettings();
  const apiKey = settings.openRouterSearchApiKey;
  if (!apiKey) return { ok: false, error: "OpenRouter API key not configured" };

  const model = settings.openRouterSearchModel || "openai/gpt-4.1-mini";
  const maxTokens = settings.openRouterSearchMaxTokens || 4096;
  const maxResults = Math.min(10, Math.max(1, settings.openRouterSearchMaxResults || 5));

  try {
    const response = await fetch("https://openrouter.ai/api/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://claw-cowork.local",
        "X-Title": "Claw Cowork",
      },
      body: JSON.stringify({
        model,
        input: args.query,
        max_output_tokens: maxTokens,
        tools: [{ type: "web_search_preview", search_context_size: "medium" }],
        plugins: [{ id: "web", max_results: maxResults }],
      }),
    });

    if (!response.ok) {
      return { ok: false, error: `OpenRouter API error ${response.status}: ${await response.text()}` };
    }

    const data = await response.json();
    const output = data.output || [];
    let text = "";
    const citations: Array<{ url: string; title?: string }> = [];

    for (const item of output) {
      if (item.type === "message" && item.content) {
        for (const block of item.content) {
          if (block.type === "output_text") {
            text += block.text || "";
            for (const ann of block.annotations || []) {
              if (ann.type === "url_citation" && ann.url) {
                citations.push({ url: ann.url, title: ann.title });
              }
            }
          }
        }
      }
    }

    return { ok: true, text: text.slice(0, 15000), citations: citations.slice(0, 20), model };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ─── Subagent Tool (openclaw-style) ─────────────────────────────────────────

async function spawnSubagentTool(
  args: { task: string; context?: string; allowed_tools?: string[] },
  parentDepth = 0
): Promise<any> {
  try {
    const result = await runSubagent({
      task: args.task,
      context: args.context,
      allowedTools: args.allowed_tools,
      parentDepth,
    });
    return {
      ok: true,
      result: result.content,
      toolResults: result.toolResults?.map((tr) => ({ tool: tr.tool, summary: JSON.stringify(tr.result).slice(0, 200) })),
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────

export async function callTool(name: string, args: any, subagentDepth = 0): Promise<any> {
  switch (name) {
    case "web_search": return webSearch(args);
    case "openrouter_web_search": return openRouterWebSearch(args);
    case "fetch_url": return fetchUrl(args);
    case "run_python": return runPythonTool(args);
    case "run_react": return runReactTool(args);
    case "run_shell": return runShell(args);
    case "read_file": return readFileTool(args);
    case "read_pdf": return readPdfTool(args);
    case "write_file": return writeFileTool(args);
    case "list_files": return listFilesTool(args);
    case "list_skills": return listSkillsTool();
    case "load_skill": return loadSkillTool(args);
    case "clawhub_search": return clawhubSearchTool(args);
    case "clawhub_install": return clawhubInstallTool(args);
    case "spawn_subagent": return spawnSubagentTool(args, subagentDepth);
    default:
      if (isMcpTool(name)) return callMcpTool(name, args);
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
