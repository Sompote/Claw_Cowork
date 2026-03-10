import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("data");

function readJSON(file: string): any {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) return file.endsWith("settings.json") ? {} : [];
  return JSON.parse(fs.readFileSync(fp, "utf-8"));
}

function writeJSON(file: string, data: any): void {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// Chat history
export interface ChatSession {
  id: string;
  title: string;
  messages: Array<{ role: string; content: string; timestamp: string; files?: string[] }>;
  createdAt: string;
  updatedAt: string;
}

export function getChatHistory(): ChatSession[] {
  return readJSON("chat_history.json");
}

export function saveChatHistory(sessions: ChatSession[]): void {
  writeJSON("chat_history.json", sessions);
}

// Tasks (cron)
export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  command: string;
  enabled: boolean;
  lastRun?: string;
  lastResult?: string;
  createdAt: string;
}

export function getTasks(): ScheduledTask[] {
  return readJSON("tasks.json");
}

export function saveTasks(tasks: ScheduledTask[]): void {
  writeJSON("tasks.json", tasks);
}

// Settings
export interface Settings {
  sandboxDir: string;
  // API config (OpenRouter-compatible)
  apiKey: string;
  apiModel: string;
  apiUrl?: string;
  // Agent loop config
  agentTemperature?: number;
  agentMaxToolRounds?: number;
  agentMaxToolCalls?: number;
  agentToolResultMaxLen?: number;
  agentMaxConsecutiveErrors?: number;
  // Reflection loop
  agentReflectionEnabled?: boolean;
  agentEvalThreshold?: number;
  agentMaxReflectionRetries?: number;
  // MCP tools
  mcpTools: Array<{ name: string; url: string; enabled: boolean }>;
  // Web search
  webSearchEnabled: boolean;
  webSearchApiKey?: string;
  webSearchEngine?: string;
  googleSearchCx?: string;
  // OpenRouter web search
  openRouterSearchEnabled?: boolean;
  openRouterSearchApiKey?: string;
  openRouterSearchModel?: string;
  openRouterSearchMaxTokens?: number;
  openRouterSearchMaxResults?: number;
  // Python
  pythonPath?: string;
  [key: string]: any;
}

export function getSettings(): Settings {
  return readJSON("settings.json");
}

export function saveSettings(settings: Settings): void {
  writeJSON("settings.json", settings);
}

// Projects
export interface Project {
  id: string;
  name: string;
  description: string;
  workingFolder: string;
  folderLocation: "sandbox" | "external";
  folderAccess: "readonly" | "readwrite" | "full";
  memory: string;
  skills: string[];
  createdAt: string;
  updatedAt: string;
}

export function getProjects(): Project[] {
  return readJSON("projects.json");
}

export function saveProjects(projects: Project[]): void {
  writeJSON("projects.json", projects);
}

// Skills
export interface Skill {
  id: string;
  name: string;
  description: string;
  source: "claude" | "openclaw" | "custom" | "clawhub";
  script: string;
  enabled: boolean;
  installedAt: string;
}

export function getSkills(): Skill[] {
  return readJSON("skills.json");
}

export function saveSkills(skills: Skill[]): void {
  writeJSON("skills.json", skills);
}
