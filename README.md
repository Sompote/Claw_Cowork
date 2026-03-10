# Claw Cowork

A self-hosted AI workspace that merges the rich React frontend of **Tiger Cowork** with the advanced agent architecture of **OpenClaw** — served on a single port.

---

## Features

### Frontend (from Tiger Cowork)
- **Chat** — Real-time streaming chat with tool-call status updates via Socket.IO
- **Projects** — Dedicated workspaces with memory, file access, and skill selection
- **Files** — Sandbox file manager with upload, edit, download, and preview (PDF, DOCX, images)
- **Tasks** — Scheduled cron jobs for automated commands
- **Skills** — ClawHub skill marketplace: search, install, and manage skills
- **Settings** — Full API configuration, agent tuning, MCP server management

### Backend Agent (from OpenClaw)
- **Sectioned system prompt** — Identity / Tooling / Workspace / Skills / Memory sections
- **Subagent spawning** — `spawn_subagent` tool delegates sub-tasks to independent agent loops (max depth 3)
- **Depth tracking** — Subagents cannot spawn further subagents beyond the configured max depth
- **Minimal prompt mode** — Subagents receive a lightweight system prompt to reduce token overhead
- **Reflection loop** — Optional self-evaluation: score output, identify gaps, re-enter loop if score < threshold
- **Tool policy** — Per-project folder access control (read-only / read-write / full exec)
- **OpenRouter-native** — Default API URL points to OpenRouter; works with any OpenAI-compatible endpoint

### Single Port
Vite dev server runs in middleware mode embedded inside Express — both the React UI and all `/api/*` routes are served on **one port** (default `3001`).

---

## Quick Start

### Requirements
- Node.js 18+
- Python 3 (for `run_python` tool)
- npm

### 1. Install dependencies

```bash
cd claw_cowork
npm install
cd client && npm install && cd ..
```

### 2. Configure environment (optional)

```bash
cp .env.example .env
# Edit .env if needed (PORT, SANDBOX_DIR, ACCESS_TOKEN)
```

### 3. Start the server

```bash
npm run dev
```

Open **http://localhost:3001** in your browser.

### 4. Add your API key

Go to **Settings** and enter:
- **API Key** — Your OpenRouter key (`sk-or-v1-...`) or any OpenAI-compatible key
- **API URL** — `https://openrouter.ai/api/v1/chat/completions` (default)
- **Model** — e.g. `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4-5`, `google/gemini-2.0-flash`

Click **Test Connection** to verify, then **Save changes**.

---

## Project Structure

```
claw_cowork/
├── server/
│   ├── index.ts                  # Express + Socket.IO + Vite middleware (single port)
│   ├── routes/
│   │   ├── chat.ts               # Chat session CRUD
│   │   ├── files.ts              # Sandbox file operations
│   │   ├── projects.ts           # Project management
│   │   ├── settings.ts           # Settings + MCP server management
│   │   ├── skills.ts             # Skill install/manage
│   │   ├── tasks.ts              # Cron job scheduling
│   │   ├── tools.ts              # Web search + URL fetch proxy
│   │   ├── python.ts             # Python execution endpoint
│   │   └── clawhub.ts            # ClawHub marketplace proxy
│   └── services/
│       ├── agent.ts              # Core agent: loop, subagents, reflection, prompt builder
│       ├── toolbox.ts            # Tool definitions + dispatcher (incl. spawn_subagent)
│       ├── socket.ts             # Socket.IO handlers for chat and project chat
│       ├── data.ts               # JSON file persistence (settings, sessions, projects, skills)
│       ├── mcp.ts                # MCP SDK client (Stdio / SSE / StreamableHTTP)
│       ├── python.ts             # Python subprocess runner
│       ├── sandbox.ts            # Sandboxed file access helpers
│       ├── scheduler.ts          # node-cron job scheduler
│       └── clawhub.ts            # ClawHub CLI wrapper
├── client/
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── components/
│       │   ├── Layout.tsx         # Sidebar navigation layout
│       │   ├── AuthGate.tsx       # Optional access-token gate
│       │   └── ReactComponentRenderer.tsx  # Renders AI-generated React/JSX
│       ├── pages/
│       │   ├── ChatPage.tsx
│       │   ├── ProjectsPage.tsx
│       │   ├── FilesPage.tsx
│       │   ├── TasksPage.tsx
│       │   ├── SkillsPage.tsx
│       │   └── SettingsPage.tsx
│       ├── hooks/useSocket.ts
│       └── utils/api.ts
├── data/                          # Auto-created JSON storage
│   ├── settings.json
│   ├── chat_history.json
│   ├── projects.json
│   ├── skills.json
│   └── tasks.json
├── ClawCowork_skills/             # Installed ClawHub skills directory
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Agent Architecture

### System Prompt Sections

The agent uses OpenClaw's sectioned prompt style:

```
## Identity
You are Claw Cowork, an advanced agentic AI workspace...

## Tooling
Available tools: web_search, fetch_url, run_python, run_react,
run_shell, read_file, write_file, list_files, list_skills,
load_skill, clawhub_search, clawhub_install, spawn_subagent, mcp_*

### Tool Rules
[detailed rules for tool use]

## Workspace
[project folder info, memory.md context]

## Skills (mandatory)
[installed skills with scan instructions]

## Memory
[memory recall instructions]
```

Subagents receive a **minimal** prompt (Identity + Tooling only) to reduce token cost.

### Agent Loop

```
User message
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Main Agent Loop (max 8 rounds, 12 tool calls)  │
│                                                 │
│  LLM call → tool_calls? ──No──► earlyContent   │
│       │                                         │
│      Yes                                        │
│       ▼                                         │
│  Execute tools (with access policy check)       │
│  Loop detection (same signature × 3 → break)   │
│  Consecutive error tracking (max 3 → break)     │
│       │                                         │
│  repeat...                                      │
└─────────────────────────────────────────────────┘
    │
    ▼ (optional)
┌─────────────────────────────────────────────────┐
│  Reflection Loop (if enabled)                   │
│                                                 │
│  Evaluate score (0.0–1.0) via separate LLM call │
│  score < threshold → inject gap message         │
│                    → retry tool rounds (max 5)  │
│  repeat up to maxReflectionRetries times        │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│  Nudge Loop (if user wanted charts but none     │
│  were generated — up to 3 extra rounds)         │
└─────────────────────────────────────────────────┘
    │
    ▼
Final summary LLM call → response to user
```

### Subagent Pattern (from OpenClaw)

The `spawn_subagent` tool lets the main agent delegate sub-tasks:

```
Main Agent (depth 0)
    │
    ├─ spawn_subagent("research X") → Sub-Agent (depth 1)
    │       │
    │       └─ spawn_subagent("fetch details") → Sub-Agent (depth 2)
    │               │
    │               └─ [spawn_subagent blocked at depth 3]
    │
    └─ Result merged back into main agent context
```

- **Max depth**: 3 (configurable via `MAX_SUBAGENT_DEPTH` in `agent.ts`)
- **Tool restriction**: `spawn_subagent` is removed from subagents' tool list
- **Allowed tools**: caller can restrict which tools the subagent can use via `allowed_tools`

---

## Built-in Tools

| Tool | Description |
|------|-------------|
| `web_search` | DuckDuckGo + Wikipedia search |
| `openrouter_web_search` | AI-summarized web search via OpenRouter Responses API |
| `fetch_url` | Fetch any URL (HTML, JSON, APIs) |
| `run_python` | Execute Python in sandbox (`output_file/` working dir) |
| `run_react` | Compile and render JSX/React in output panel (Recharts included) |
| `run_shell` | Execute shell commands (respects project folder access policy) |
| `read_file` | Read a file from disk |
| `write_file` | Write or append to a file |
| `list_files` | List directory contents |
| `list_skills` | List installed ClawHub skills |
| `load_skill` | Read a skill's SKILL.md instructions |
| `clawhub_search` | Search ClawHub marketplace |
| `clawhub_install` | Install a skill from ClawHub |
| `spawn_subagent` | Delegate a sub-task to an independent sub-agent |
| `mcp_*` | Any tool from connected MCP servers |

---

## Settings Reference

### API Configuration

| Field | Description | Default |
|-------|-------------|---------|
| `apiKey` | OpenRouter or OpenAI-compatible API key | — |
| `apiUrl` | Chat completions endpoint | `https://openrouter.ai/api/v1/chat/completions` |
| `apiModel` | Model ID | `openai/gpt-4o-mini` |

### Agent Parameters

| Field | Description | Default |
|-------|-------------|---------|
| `agentMaxToolRounds` | Max iterations of the tool loop | `8` |
| `agentMaxToolCalls` | Max total tool calls per turn | `12` |
| `agentMaxConsecutiveErrors` | Stop after N consecutive tool failures | `3` |
| `agentToolResultMaxLen` | Max chars per tool result (truncated beyond) | `6000` |
| `agentTemperature` | LLM temperature | `0.7` |

### Reflection Loop

| Field | Description | Default |
|-------|-------------|---------|
| `agentReflectionEnabled` | Enable post-loop self-evaluation | `false` |
| `agentEvalThreshold` | Min score (0.0–1.0) to consider satisfied | `0.7` |
| `agentMaxReflectionRetries` | Max re-evaluation rounds | `2` |

### OpenRouter Web Search

| Field | Description | Default |
|-------|-------------|---------|
| `openRouterSearchEnabled` | Enable `openrouter_web_search` tool | `false` |
| `openRouterSearchApiKey` | OpenRouter API key for search | — |
| `openRouterSearchModel` | Model for search (must support web plugin) | `openai/gpt-4.1-mini` |
| `openRouterSearchMaxTokens` | Max output tokens per search | `4096` |
| `openRouterSearchMaxResults` | Max web results (1–10) | `5` |

---

## Environment Variables

```env
PORT=3001              # Server port (default: 3001)
SANDBOX_DIR=           # Sandbox working directory (default: project root)
ACCESS_TOKEN=          # Optional UI access token (blank = no auth)
NODE_ENV=development   # Set to "production" to serve built client
```

---

## MCP Server Integration

Connect external tools via Model Context Protocol in **Settings → MCP Servers**.

Supports:
- **HTTP/SSE** — `http://localhost:8080/mcp`
- **StreamableHTTP** — tried first, falls back to SSE
- **Stdio** — `npx @modelcontextprotocol/server-github`

Discovered tools appear as `mcp_{serverName}_{toolName}` and are available to the agent automatically.

---

## Projects

Each project has:
- **Working folder** — sandbox (inside the sandbox dir) or external local path
- **Folder access** — `readonly` | `readwrite` | `full` (exec allowed)
- **Memory** — `memory.md` file in the working folder; injected into every project chat
- **Skills** — priority skills pre-loaded for that project's context

---

## Skills (ClawHub)

Skills are stored in `ClawCowork_skills/<slug>/SKILL.md`.

Install via the **Skills** page or by asking the agent:
> "Install the duckduckgo-search skill from ClawHub"

The agent reads SKILL.md instructions via `load_skill` before executing a skill.

---

## Production Build

```bash
# Build the React frontend
npm run build

# Start production server
NODE_ENV=production npm start
```

The production server serves the built `client/dist/` statically and handles all API routes on the same port.

---

## Running with PM2

[PM2](https://pm2.keymetrics.io/) keeps the server alive in the background and auto-restarts it on crashes.

### Install PM2

```bash
npm install -g pm2
```

### Start in development mode

```bash
pm2 start npm --name claw-cowork -- run dev
```

### Start in production mode

```bash
npm run build
pm2 start npm --name claw-cowork -- start
```

Or use an ecosystem file for more control — create `ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: 'claw-cowork',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
```

Then run:

```bash
npm run build
pm2 start ecosystem.config.js
```

### Useful PM2 commands

| Command | Description |
|---------|-------------|
| `pm2 list` | Show all running processes |
| `pm2 logs claw-cowork` | Stream logs |
| `pm2 restart claw-cowork` | Restart the app |
| `pm2 stop claw-cowork` | Stop the app |
| `pm2 delete claw-cowork` | Remove from PM2 |
| `pm2 save` | Save process list |
| `pm2 startup` | Auto-start PM2 on system boot |

### Auto-start on reboot

```bash
pm2 startup        # generates a system command — run the output command
pm2 save           # saves the current process list
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload (Vite embedded) |
| `npm run build` | Build React client to `client/dist/` |
| `npm start` | Start production server |

---

## Data Storage

All data is stored as JSON files in the `data/` directory:

| File | Contents |
|------|----------|
| `settings.json` | API config, agent params, MCP servers |
| `chat_history.json` | All chat sessions and messages |
| `projects.json` | Project definitions |
| `skills.json` | Installed skill registry |
| `tasks.json` | Scheduled cron tasks |

Output files generated by the agent (charts, reports, React components) are saved to `{sandboxDir}/output_file/` and rendered in the right-side output panel.

---

## Architecture Overview

```
Browser
  │  React SPA (Chat, Projects, Files, Tasks, Skills, Settings)
  │  Socket.IO client (streaming chat events)
  ▼
Express Server (port 3001)
  ├── /api/chat          → chat.ts
  ├── /api/projects      → projects.ts
  ├── /api/files         → files.ts
  ├── /api/settings      → settings.ts (+ MCP management)
  ├── /api/skills        → skills.ts + clawhub.ts
  ├── /api/tasks         → tasks.ts + scheduler.ts
  ├── /api/python        → python.ts
  ├── /api/tools         → tools.ts
  ├── /sandbox/*         → static sandbox file serving
  ├── Socket.IO
  │     ├── chat:send           → agent loop → tool calls → response
  │     └── project:chat:send   → project-aware agent loop
  └── Vite middleware (dev) / static dist (prod)
        └── React SPA
```

---

## License

MIT
