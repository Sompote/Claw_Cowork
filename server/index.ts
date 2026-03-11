import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { chatRouter } from "./routes/chat";
import { filesRouter } from "./routes/files";
import { tasksRouter } from "./routes/tasks";
import { skillsRouter } from "./routes/skills";
import { settingsRouter } from "./routes/settings";
import { pythonRouter } from "./routes/python";
import { toolsRouter } from "./routes/tools";
import { clawhubRouter } from "./routes/clawhub";
import { projectsRouter } from "./routes/projects";
import { telegramRouter } from "./routes/telegram";
import { setupSocket } from "./services/socket";
import { initMcpServers } from "./services/mcp";

dotenv.config();

const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const PORT = process.env.PORT || 3001;
const SANDBOX_DIR = process.env.SANDBOX_DIR || path.resolve(".");
const DATA_DIR = path.resolve("data");

// Ensure directories exist
[
  SANDBOX_DIR,
  DATA_DIR,
  path.resolve("ClawCowork_skills"),
  path.join(SANDBOX_DIR, "output_file"),
].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Initialize data files
const dataFiles = ["chat_history.json", "tasks.json", "settings.json", "skills.json", "projects.json"];
dataFiles.forEach((file) => {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) {
    const initial =
      file === "settings.json"
        ? JSON.stringify(
            {
              sandboxDir: SANDBOX_DIR,
              apiKey: "",
              apiModel: "openai/gpt-4o-mini",
              apiUrl: "https://openrouter.ai/api/v1/chat/completions",
              mcpTools: [],
              webSearchEnabled: false,
              openRouterSearchEnabled: false,
            },
            null,
            2
          )
        : "[]";
    fs.writeFileSync(fp, initial);
  }
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.locals.sandboxDir = SANDBOX_DIR;
app.locals.dataDir = DATA_DIR;

// Auth verify endpoint (no auth required)
app.post("/api/auth/verify", (req, res) => {
  if (!ACCESS_TOKEN) return res.json({ ok: true, required: false });
  const token = req.body.token;
  if (token === ACCESS_TOKEN) return res.json({ ok: true });
  return res.status(401).json({ ok: false, error: "Invalid access token" });
});

// Access token middleware for /api routes
app.use("/api", (req, res, next) => {
  if (req.path === "/auth/verify") return next();
  if (!ACCESS_TOKEN) return next();
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
  if (token === ACCESS_TOKEN) return next();
  return res.status(401).json({ error: "Unauthorized — invalid or missing access token" });
});

// API routes
app.use("/api/chat", chatRouter);
app.use("/api/files", filesRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/python", pythonRouter);
app.use("/api/tools", toolsRouter);
app.use("/api/clawhub", clawhubRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/telegram", telegramRouter);

// Serve sandbox files
app.use("/sandbox", express.static(SANDBOX_DIR));

// Socket.IO auth
if (ACCESS_TOKEN) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token === ACCESS_TOKEN) return next();
    return next(new Error("Unauthorized — invalid or missing access token"));
  });
}

setupSocket(io);

// Start: Vite middleware (dev) or static (prod) — SINGLE PORT
async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      root: path.resolve("client"),
      server: { middlewareMode: true, hmr: { server } },
    });
    app.use(vite.middlewares);
  } else {
    const clientDist = path.resolve("client/dist");
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(clientDist, "index.html"));
      });
    }
  }

  server.listen(PORT, () => {
    console.log(`Claw Cowork running on http://localhost:${PORT}`);
    console.log(`Sandbox directory: ${SANDBOX_DIR}`);
    initMcpServers().catch((err) => console.error("[MCP] Init error:", err.message));
  });
}

start();

export { io };
