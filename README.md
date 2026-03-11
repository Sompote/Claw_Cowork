# Claw Cowork

**Version 0.1.2**

![Claw Cowork Screenshot](picture/scree_claw.png)

A self-hosted AI workspace that merges the rich React frontend of **Tiger Cowork** with the advanced agent architecture of **OpenClaw** — served on a single port.

---

## What is Claw Cowork?

Claw Cowork is a **personal AI assistant you run on your own server**. You open it in a browser, talk to it like a chat app, and it can actually *do things* — write and run code, search the web, read your files, generate charts, manage projects, and reply to you on Telegram. Everything runs inside Docker on your own machine. No data leaves your server unless you send it to an AI API of your choice.

### What it can do

**Chat with a powerful AI agent**
Type a message and the agent reasons through it, picks the right tools, and gets things done. It is not just a chatbot — it runs multiple tool calls per turn, can spawn sub-agents for parallel work, and evaluates its own output before finishing.

**Write and run code**
The agent can write Python scripts and run them immediately inside a sandbox. Charts, reports, and output files appear in the right-side output panel. It can also generate interactive React components and render them live.

**Search the web**
Built-in web search (DuckDuckGo, Google, or OpenRouter AI search) lets the agent look things up without leaving the conversation.

**Read and work with your files**
Upload PDFs, Word documents, images, and code files directly into chat. The agent reads them, analyses them, and can generate new files in response. A built-in file manager lets you browse, edit, and download everything in the sandbox.

**Manage projects**
Create separate workspaces for different projects. Each project has its own working folder, memory notes, skill selection, and file access policy. The agent remembers project context across conversations.

**Telegram bot**
Connect a Telegram bot in Settings and the agent will answer your messages from Telegram in real time — using the same full agent loop as the web chat. Great for quick questions on the go.

**Extend with skills and MCP**
Install skills from the ClawHub marketplace (or upload your own) to give the agent new capabilities. Connect external tools via Model Context Protocol (MCP) — any MCP server becomes available as a tool automatically.

**Schedule tasks**
Set up cron jobs that run agent commands on a schedule — daily reports, monitoring checks, automated workflows.

### Key properties

| Property | Detail |
|---|---|
| **Self-hosted** | Runs entirely on your own machine inside Docker |
| **Single port** | UI and API both served on port 3001 — no reverse proxy needed |
| **Model-agnostic** | Works with OpenRouter, OpenAI, Anthropic, local OpenClaw, or any OpenAI-compatible API |
| **No lock-in** | All data stored as plain JSON files in `data/` — portable and easy to back up |
| **Real-time** | Tool call status, streaming responses, and Telegram messages all use Socket.IO |

---

## Access Token Security

Claw Cowork automatically generates a secure access token on first startup and stores it in `data/settings.json`. The token protects all routes — API, file system, and WebSocket connections.

### How it works

- **Auto-generated on first run** — a 64-character random token is created and printed to the server log once
- **Login screen** — the token is shown directly on the login screen so any user on the network can copy and paste it to log in
- **Persists across restarts** — the token survives server restarts; it only changes when you rotate it
- **Single token, all access** — one token controls login, all `/api/*` routes, `/sandbox/*` file serving, and the Socket.IO connection

### Token rotation

In **Settings → Access Security** you can:

- See the current token preview and when it was last rotated
- Click **Copy Token** to copy the full token to your clipboard (for use in other browsers)
- Click **Rotate Token** to generate a new token

**Grace period:** after rotation, the old token stays valid for **1 hour** so active users are not immediately locked out.

### Switching browsers or devices

When opening Claw Cowork in a new browser:

1. The login screen shows the full token — copy it and click **Enter**
2. Or, from a logged-in browser: **Settings → Access Security → Copy Token**, then paste it in the new browser

### Token via environment variable

If you set `ACCESS_TOKEN` in `.env` or `docker-compose.yml`, that value takes priority over the auto-generated token. In that case, rotation from the UI is disabled — change the env var to rotate.

```env
ACCESS_TOKEN=your-secret-token-here
```

---

## SECURITY WARNING

> **THIS APPLICATION EXECUTES AI-GENERATED CODE, SHELL COMMANDS, AND THIRD-PARTY SKILLS ON YOUR MACHINE.**

The AI agent can:
- Execute arbitrary **shell commands**
- Run **Python scripts**
- **Read and write files** anywhere the process can access
- **Install third-party skills** from the internet
- **Spawn subagents** that repeat all of the above

**Running this app directly on your host system is a serious security risk.**

### What you MUST do

- **Run inside Docker** — isolate all execution from your host system
- **Set an `ACCESS_TOKEN`** before connecting to any network
- **Do not expose port 3001 publicly** without authentication
- **Review access levels** — use Read Only or Read & Write for external folders whenever possible; only grant Full Access when necessary

> Recommended environment: **Docker container on Ubuntu** (instructions below).
> Do NOT run as root on your host system.

---

## Docker Setup — From Scratch (Ubuntu)

> **Docker not installed yet?**
> ```bash
> # Ubuntu/Debian host
> sudo apt-get install -y docker.io && sudo systemctl start docker
> ```
> macOS/Windows: install [Docker Desktop](https://www.docker.com/products/docker-desktop/).

### Step 1 — Start a fresh Ubuntu container (on your host machine)

```bash
docker run -it \
  --name claw-cowork \
  -p 3001:3001 \
  ubuntu:22.04 bash
```

> **Need to mount host folders?**
> ```bash
> docker run -it --name claw-cowork -p 3001:3001 \
>   -v /home/yourname:/mnt/host:rw \
>   ubuntu:22.04 bash
> ```
> You cannot add mounts after the container is created — mount a large parent folder upfront.

---

### Step 2 — Run the installer (inside the container)

Paste this single command. It installs all system packages, Python libraries, Node.js 22, clones the repo, installs dependencies, and starts the app:

```bash
apt update && apt install -y curl
curl -fsSL https://raw.githubusercontent.com/Sompote/Claw_Cowork/master/install.sh | bash
```

Open **http://localhost:3001** in your browser.

<details>
<summary>What the installer does (step by step)</summary>

1. `apt-get` — installs `curl`, `git`, `build-essential`, `python3`, `python3-pip`, etc.
2. `pip3` — installs `pandas`, `numpy`, `matplotlib`, `seaborn`, `scipy`, `fpdf2`, `python-docx`, `reportlab`, `pillow`
3. Node.js 22 via NodeSource
4. `git clone` the Claw Cowork repository to `/root/claw_cowork`
5. `npm install` (server) + `npm install --prefix client` (frontend)
6. Creates `.env` from `.env.example` if missing
7. Starts the app with `npm run dev`

</details>

<details>
<summary>Manual install (run each step yourself)</summary>

**Inside the container:**
```bash
# System packages
apt-get update && apt-get install -y curl git build-essential python3 python3-pip nano

# Python packages
pip3 install requests pandas numpy matplotlib seaborn scipy fpdf2 python-docx reportlab pillow

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Clone
cd /root
git clone https://github.com/Sompote/Claw_Cowork.git claw_cowork
cd claw_cowork

# Install & run
bash setup.sh
```

**Set access token (recommended before first run):**
```bash
nano /root/claw_cowork/.env
```
```env
ACCESS_TOKEN=your-secret-token-here
PORT=3001
```

</details>

---

### Step 3 — Add your API key

Go to **Settings** and enter:
- **API Key** — Your OpenRouter key (`sk-or-v1-...`) or any OpenAI-compatible key
- **API URL** — `https://openrouter.ai/api/v1/chat/completions` (default)
- **Model** — e.g. `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4-5`, `google/gemini-2.0-flash`

Click **Test Connection** to verify, then **Save changes**.

---

### Reconnect to the container later

If you close your terminal, the container stops. To resume:
```bash
# Start the stopped container
docker start claw-cowork

# Open a shell inside it
docker exec -it claw-cowork bash

# Start the app again
cd /root/claw_cowork
npm run dev
```

To keep the app running after you disconnect, use PM2 (see [Running with PM2](#running-with-pm2) below).

---

## Telegram Setup

Connect a Telegram bot so the AI agent answers messages sent directly to it.

### 1 — Create a bot

1. Open Telegram and message **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the bot token (format: `1234567890:AABBccddEEff...`)

### 2 — Connect in Settings

1. Go to **Settings → Telegram**
2. Paste the token into **Bot Token**
3. Click **Save changes**
4. Click **Connect** — status shows *Connected as @YourBotName*

### 3 — Set your Chat ID

1. Open your bot in Telegram and send any message (e.g. `/start`)
2. Back in Settings, click **Detect my Chat ID** — the field auto-fills
3. Click **Save changes**

### 4 — Test

Use the **Send test message** box in Settings to confirm the bot can reach you.

### How it works

- The server runs a long-poll loop that receives messages from Telegram in real time
- Each incoming message is passed to the AI agent (same agent loop used in the web chat)
- The agent's reply is sent back to the Telegram chat automatically
- Conversation history is saved as a `telegram_<chatId>` session — visible in the **Chat** sidebar
- Long replies (>4096 characters) are split into multiple messages automatically

### Connecting to a local OpenClaw gateway

If you are running OpenClaw locally, you can point Claw Cowork at it instead of OpenRouter:

| Setting | Value |
|---------|-------|
| API URL | `http://localhost:18789/v1/chat/completions` |
| API Key | your `OPENCLAW_GATEWAY_TOKEN` |
| Model | `openclaw` (any value works) |

---

## Mounting Host Folders

Give the AI access to specific directories on your host by mounting them as Docker volumes at container startup.

```bash
# Single folder, read-write
docker run -it --name claw-cowork -p 3001:3001 \
  -v /home/yourname/projects:/mnt/projects:rw \
  ubuntu:22.04 bash

# Single folder, read-only
docker run -it --name claw-cowork -p 3001:3001 \
  -v /home/yourname/data:/mnt/data:ro \
  ubuntu:22.04 bash

# Multiple folders
docker run -it --name claw-cowork -p 3001:3001 \
  -v /home/yourname/projects:/mnt/projects:rw \
  -v /home/yourname/datasets:/mnt/data:ro \
  ubuntu:22.04 bash
```

Inside the app: create a project with **External Folder** pointing to `/mnt/projects` or `/mnt/data`, and choose the appropriate access level.

**Tips:**
- `:rw` = read-write, `:ro` = read-only
- Mount a large parent folder (e.g. your home directory) to avoid restarting Docker when you need to access a new subfolder
- The app's **Overview** tab generates ready-to-copy `docker run` and `docker-compose` mount commands for your projects

---

## docker-compose Setup (Alternative)

Create `docker-compose.yml` on your host:

```yaml
version: "3.9"

services:
  claw-cowork:
    image: ubuntu:22.04
    container_name: claw-cowork
    ports:
      - "3001:3001"
    volumes:
      - /home/yourname/projects:/mnt/projects:rw
      - claw-data:/root/claw_cowork
    working_dir: /root
    environment:
      - ACCESS_TOKEN=your-secret-token-here
      - PORT=3001
    stdin_open: true
    tty: true
    command: >
      bash -c "
        apt-get update &&
        apt-get install -y curl git python3 python3-pip build-essential nano &&
        pip3 install requests pandas numpy matplotlib seaborn scipy &&
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash - &&
        apt-get install -y nodejs &&
        git clone https://github.com/Sompote/claw_cowork.git &&
        cd claw_cowork &&
        npm install &&
        cd client && npm install && cd .. &&
        echo 'ACCESS_TOKEN=your-secret-token-here' > .env &&
        npm run dev
      "

volumes:
  claw-data:
```

Run with:
```bash
docker-compose up
```

---

## Features

### Frontend (from Tiger Cowork)
- **Chat** — Real-time streaming chat with tool-call status updates via Socket.IO
- **Projects** — Dedicated workspaces with memory, file access, and skill selection
- **Files** — Sandbox file manager with upload, edit, download, and preview (PDF, DOCX, images)
- **Tasks** — Scheduled cron jobs for automated commands
- **Skills** — ClawHub skill marketplace: search, install, and manage skills
- **Settings** — Full API configuration, agent tuning, MCP server management, Telegram integration

### Backend Agent (from OpenClaw)
- **Sectioned system prompt** — Identity / Tooling / Workspace / Skills / Memory sections
- **Subagent spawning** — `spawn_subagent` tool delegates sub-tasks to independent agent loops (max depth 3)
- **Depth tracking** — Subagents cannot spawn further subagents beyond the configured max depth
- **Minimal prompt mode** — Subagents receive a lightweight system prompt to reduce token overhead
- **Reflection loop** — Optional self-evaluation: score output, identify gaps, re-enter loop if score < threshold
- **Tool policy** — Per-project folder access control (read-only / read-write / full exec)
- **OpenRouter-native** — Default API URL points to OpenRouter; works with any OpenAI-compatible endpoint

### Telegram Bot
- **Two-way messaging** — Send and receive messages via your Telegram bot
- **Agent-powered replies** — Every incoming Telegram message goes through the full AI agent loop
- **Persistent history** — Conversations stored in chat history, visible in the web UI sidebar
- **Auto chat ID detection** — Polling loop saves your chat ID automatically on first message

### Single Port
Vite dev server runs in middleware mode embedded inside Express — both the React UI and all `/api/*` routes are served on **one port** (default `3001`).

---

## Quick Start (Local — Not Recommended)

> Only do this if you understand the security risks. Docker is strongly preferred.

### Requirements
- Node.js 18+
- Python 3 (for `run_python` tool)
- npm

### Install

```bash
cd claw_cowork
npm install
cd client && npm install && cd ..
```

### Configure environment (optional)

```bash
cp .env.example .env
# Edit .env: set PORT, SANDBOX_DIR, ACCESS_TOKEN
```

### Run

```bash
npm run dev
# Open http://localhost:3001
```

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
│   │   ├── clawhub.ts            # ClawHub marketplace proxy
│   │   └── telegram.ts           # Telegram bot API routes
│   └── services/
│       ├── agent.ts              # Core agent: loop, subagents, reflection, prompt builder
│       ├── toolbox.ts            # Tool definitions + dispatcher (incl. spawn_subagent)
│       ├── socket.ts             # Socket.IO handlers for chat and project chat
│       ├── data.ts               # JSON file persistence (settings, sessions, projects, skills)
│       ├── mcp.ts                # MCP SDK client (Stdio / SSE / StreamableHTTP)
│       ├── python.ts             # Python subprocess runner
│       ├── sandbox.ts            # Sandboxed file access helpers
│       ├── scheduler.ts          # node-cron job scheduler
│       ├── telegram.ts           # Telegram bot: polling, agent reply, chat ID detection
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
run_shell, read_file, read_pdf, write_file, list_files, list_skills,
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
Final summary LLM call → response to user
```

### Subagent Pattern (from OpenClaw)

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
| `read_file` | Read a text file from disk |
| `read_pdf` | Extract text content from a PDF file |
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

### Telegram

| Field | Description |
|-------|-------------|
| `telegramBotToken` | Bot token from @BotFather |
| `telegramChatId` | Target chat ID — auto-filled by Detect my Chat ID |

---

## Environment Variables

```env
PORT=3001              # Server port (default: 3001)
SANDBOX_DIR=           # Sandbox working directory (default: project root)
ACCESS_TOKEN=          # UI access token (blank = no auth — not recommended)
NODE_ENV=development   # Set to "production" to serve built client
```

---

## Running with PM2

PM2 keeps the app running in the background inside Docker and auto-restarts it on crashes.

```bash
# Install PM2 globally
npm install -g pm2

# Build and start in production mode
npm run build
pm2 start npm --name "claw-cowork" -- start

# View logs
pm2 logs claw-cowork

# Save process list (survives container restarts)
pm2 startup
pm2 save
```

| Command | Description |
|---------|-------------|
| `pm2 list` | Show all running processes |
| `pm2 logs claw-cowork` | Stream logs |
| `pm2 restart claw-cowork` | Restart the app |
| `pm2 stop claw-cowork` | Stop the app |
| `pm2 delete claw-cowork` | Remove from PM2 |

---

## MCP Server Integration

Connect external tools via Model Context Protocol in **Settings → MCP Servers**.

Supports:
- **HTTP/SSE** — `http://localhost:8080/mcp`
- **StreamableHTTP** — tried first, falls back to SSE
- **Stdio** — `npx @modelcontextprotocol/server-github`

Discovered tools appear as `mcp_{serverName}_{toolName}` and are available to the agent automatically.

---

## Data Storage

All data is stored as JSON files in the `data/` directory:

| File | Contents |
|------|----------|
| `settings.json` | API config, agent params, MCP servers, Telegram config |
| `chat_history.json` | All chat sessions and messages (including Telegram conversations) |
| `projects.json` | Project definitions |
| `skills.json` | Installed skill registry |
| `tasks.json` | Scheduled cron tasks |

Output files generated by the agent (charts, reports, React components) are saved to `{sandboxDir}/output_file/` and rendered in the right-side output panel.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload (Vite embedded) |
| `npm run build` | Build React client to `client/dist/` |
| `npm start` | Build frontend + start production server |

---

## License

MIT

---

## Changelog

### v0.1.2 — 2026-03-11 — Security Update

#### New Features

- **Auto-generated access token** — on first startup, a 64-character cryptographically random token is generated automatically and saved to `data/settings.json`. No manual setup required.
- **Token shown on login screen** — the full token is displayed on the login screen with a **Copy & Fill** button, so any user opening the app in a new browser can log in immediately without checking server logs.
- **Token rotation with grace period** — **Settings → Access Security** now has a **Rotate Token** button that generates a new token. The old token stays valid for 1 hour after rotation so active sessions are not instantly cut off.
- **Token age display** — Settings shows when the token was created or last rotated (e.g. "Last rotated: 5 days ago").
- **Copy Token button** — copy the full token from Settings to use in another browser or device.
- **File serving protected** — the `/sandbox/*` static file route is now token-protected. Previously it was publicly accessible to anyone who knew the port.
- **Socket.IO auth updated** — WebSocket connections now use the same dynamic token validation as the REST API, including grace period support.

#### Internal Changes

- `server/services/tokenState.ts` — new module managing in-memory token state: `initToken()`, `isValidToken()`, `hasTokenRequired()`, `rotateToken()`, `reloadTokenState()`.
- `server/services/data.ts` — added `accessToken`, `accessTokenPrev`, `accessTokenRotatedAt`, `accessTokenCreatedAt` fields to the `Settings` interface.
- `server/index.ts` — replaced static `ACCESS_TOKEN` constant with dynamic token state; added public `/api/auth/token-hint` endpoint; protected `/sandbox` static route; updated Socket.IO middleware.
- `server/routes/settings.ts` — added `GET /settings/token-info`, `GET /settings/full-token`, `POST /settings/rotate-token` endpoints.
- `client/src/components/AuthGate.tsx` — login screen now fetches and displays the full token with a Copy & Fill button.
- `client/src/pages/SettingsPage.tsx` — new **Access Security** card with token preview, rotation age, grace period notice, Copy Token button, and Rotate Token button.
- `client/src/utils/api.ts` — added `getTokenInfo`, `getFullToken`, `rotateToken` API calls.

---

### v0.1.0 — 2026-03-11

#### New Features

- **Telegram integration** — Connect a Telegram bot to Claw Cowork. Messages sent to your bot are answered by the AI agent in real time. Replies are sent back to Telegram automatically. Full two-way conversation with persistent chat history.
  - Settings → Telegram: enter bot token, click Connect, then click **Detect my Chat ID** after sending `/start` to your bot
  - Chat ID is auto-detected and saved the moment the bot receives any message
  - Conversation history stored in `chat_history.json` as a `telegram_<chatId>` session, visible in the chat sidebar
  - Long messages (>4096 chars) are split automatically to fit Telegram's limit
  - See [Telegram Setup](#telegram-setup) above

- **AI backend connection improvements** — Settings page now has a clearer **AI Backend** section with an inline connection guide for both OpenRouter and local OpenClaw gateway
  - Connecting to a local OpenClaw instance: set URL to `http://localhost:18789/v1/chat/completions`, API key to your `OPENCLAW_GATEWAY_TOKEN`, model to `openclaw`

#### Bug Fixes

- **"Bad Request" on chat** — Removed hardcoded `max_tokens: 81920` which caused 400 errors on models with lower output limits. Each model now uses its own default.
- **"404 chat not found" on chat** — Fixed URL normalization bug: URLs ending in `/chat` were incorrectly appended to become `.../chat/chat/completions`. Now strips partial suffixes before normalizing.
- **Better API error messages** — Chat errors now show the actual API error text and a specific hint (check API key / check URL / check model name) instead of a raw status code.
- **Test connection** — Same URL normalization and error detail improvements applied to the Settings test-connection endpoint.
- **Telegram "chat not found"** — Fixed by removing `parse_mode: "Markdown"` from `sendMessage` calls (Telegram rejects messages with unescaped special characters in Markdown mode). Plain text is now used by default.

#### Internal Changes

- `server/services/telegram.ts` — Full rewrite: polling loop now saves `chatId` to `settings.json` on every received message; added `replyToTelegramMessage()` that runs the agent loop and sends the response back; initial sync-poll on connect grabs any messages received while the server was offline.
- `server/routes/telegram.ts` — Added `/detect-chat-id` endpoint (reads from in-memory state or settings, no concurrent `getUpdates`); improved `/send` error messages.
- `server/services/agent.ts` — Fixed `normalizeApiUrl()` to handle partial suffixes; removed hardcoded `max_tokens`; improved error detail parsing.
- `server/routes/settings.ts` — Same URL normalization applied to test-connection; improved error detail in response.
- `client/src/pages/SettingsPage.tsx` — New AI Backend section with OpenClaw connection hint; Telegram section with step-by-step guide, Detect my Chat ID button, and inline error explanations.
- `client/src/utils/api.ts` — Added `telegramStatus`, `telegramConnect`, `telegramDisconnect`, `telegramDetectChatId`, `telegramSend`.

---

### v0.0.2 — 2026-03-10

#### New Features
- **PDF reading for the agent** — New `read_pdf` tool lets the agent extract and analyze text from uploaded PDF files. The agent now automatically uses `read_pdf` instead of `read_file` when working with `.pdf` attachments.
- **PDF/DOCX preview in chat attachments** — User-uploaded PDF and Word documents now show an inline expandable text preview directly in the chat message (click the ▼ button to expand).

#### Bug Fixes
- **Output panel: generated PDFs now appear correctly** — Fixed a path bug where agent-generated PDF files (and other outputs) were saved to a double-nested `output_file/output_file/` directory and missed by the file scanner. Files now correctly appear in the right-side output panel.
- **File scanner is now recursive** — The output file scanner in the Python runner now walks all subdirectories under `output_file/`, so files saved at any depth are detected and shown in the output panel. Detection window extended from 30s to 60s to support slower PDF generation jobs.
- **System prompt path guidance fixed** — Agent instructions now explicitly warn against prefixing save paths with `output_file/` (the Python working directory is already set there), preventing the double-path issue.

#### Internal Changes
- `server/services/python.ts` — Recursive `scanDir()` replaces flat `readdirSync` for output file detection.
- `server/services/toolbox.ts` — Added `read_pdf` tool definition and implementation using `pdf-parse`.
- `server/services/agent.ts` — Updated system prompt: added `read_pdf` to tool list and OUTPUT/CHARTS path rules.
- `client/src/pages/ChatPage.tsx` — Added `AttachmentItem` component with expandable PDF/DOCX preview; hoisted `isImageFile` to module scope.
- `client/src/pages/ChatPage.css` — New styles for expandable attachment preview.

---

### v0.0.1 — Initial Release

- Initial release combining Tiger Cowork frontend with OpenClaw agent backend.
- Single-port Express + Vite setup.
- Agent tools: `web_search`, `fetch_url`, `run_python`, `run_react`, `run_shell`, `read_file`, `write_file`, `list_files`, `list_skills`, `load_skill`, `clawhub_search`, `clawhub_install`, `spawn_subagent`, MCP tools.
- Projects, Files, Tasks, Skills, Settings pages.
- Reflection loop, subagent spawning (max depth 3), tool access policy per project folder.
- Docker setup guide and PM2 support.
