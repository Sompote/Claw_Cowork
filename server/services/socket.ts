import { Server, Socket } from "socket.io";
import { v4 as uuid } from "uuid";
import { runAgentLoop, callAgent, buildSystemPrompt } from "./agent";
import { getChatHistory, saveChatHistory, ChatSession, getSettings, getProjects, getSkills } from "./data";
import { runPython } from "./python";
import path from "path";
import { execSync } from "child_process";
import fs from "fs";

function buildSkillsPrompt(): string {
  const skillsDir = path.resolve("ClawCowork_skills");
  let installedSkills: string[] = [];
  try {
    if (fs.existsSync(skillsDir)) {
      installedSkills = fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((d: any) => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, "SKILL.md")))
        .map((d: any) => d.name);
    }
  } catch {}
  if (!installedSkills.length) return "";
  return `<available_skills>\n${installedSkills.map((s) => `<skill name="${s}" location="${path.join(skillsDir, s, "SKILL.md")}" />`).join("\n")}\n</available_skills>`;
}

function buildMainSystemPrompt(extra?: { workspaceInfo?: string; projectContext?: string }): string {
  return buildSystemPrompt({
    mode: "full",
    skillsPrompt: buildSkillsPrompt(),
    workspaceInfo: extra?.workspaceInfo,
    projectContext: extra?.projectContext,
  });
}

// Track sessions currently being processed
interface ActiveSession {
  status: string;
  tool?: string;
  title: string;
  startedAt: string;
  controller: AbortController;
}
const activeAgentSessions = new Map<string, ActiveSession>();

function emitStatus(socket: Socket, sessionId: string, data: { status: string; tool?: string; args?: any }) {
  const existing = activeAgentSessions.get(sessionId);
  if (existing) {
    existing.status = data.status;
    existing.tool = data.tool;
  }
  socket.emit("chat:status", { ...data, sessionId });
}

function clearActiveSession(sessionId: string) {
  activeAgentSessions.delete(sessionId);
}

export function getActiveAgentSessions() {
  const result: Record<string, { status: string; tool?: string; title: string; startedAt: string }> = {};
  activeAgentSessions.forEach((v, k) => {
    result[k] = { status: v.status, tool: v.tool, title: v.title, startedAt: v.startedAt };
  });
  return result;
}

export function killAgentSession(sessionId: string): boolean {
  const session = activeAgentSessions.get(sessionId);
  if (!session) return false;
  session.controller.abort();
  activeAgentSessions.delete(sessionId);
  return true;
}

export function registerActiveSession(sessionId: string, title: string, controller: AbortController) {
  activeAgentSessions.set(sessionId, { status: "thinking", title, startedAt: new Date().toISOString(), controller });
}

export function unregisterActiveSession(sessionId: string) {
  activeAgentSessions.delete(sessionId);
}

export function setupSocket(io: Server): void {
  io.on("connection", (socket: Socket) => {
    console.log("Client connected:", socket.id);

    // Send current active sessions so client can restore status after refresh
    if (activeAgentSessions.size > 0) {
      const active: Record<string, { status: string; tool?: string }> = {};
      activeAgentSessions.forEach((v, k) => { active[k] = { status: v.status, tool: v.tool }; });
      socket.emit("chat:active_sessions", active);
    }

    socket.on("agent:kill", (data: { sessionId: string }) => {
      killAgentSession(data.sessionId);
    });

    // ─── Global Chat ────────────────────────────────────────────────────────
    socket.on(
      "chat:send",
      async (data: { sessionId: string; message: string; images?: { path: string; type: string }[] }) => {
        const { sessionId, message, images } = data;
        const sessions = getChatHistory();
        let session = sessions.find((s) => s.id === sessionId);

        if (!session) {
          session = {
            id: sessionId,
            title: message.slice(0, 50),
            messages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          sessions.push(session);
        }

        session.messages.push({ role: "user", content: message, timestamp: new Date().toISOString() });
        session.updatedAt = new Date().toISOString();
        saveChatHistory(sessions);

        // Direct Python code block execution
        const pythonMatch = message.match(/```python\n([\s\S]*?)```/);
        if (pythonMatch) {
          const settings = getSettings();
          const sandboxDir = settings.sandboxDir || path.resolve("sandbox");
          emitStatus(socket, sessionId, { status: "running_python" });
          const result = await runPython(pythonMatch[1], sandboxDir);
          const resultMsg = [
            result.stdout && `Output:\n\`\`\`\n${result.stdout}\`\`\``,
            result.stderr && `Errors:\n\`\`\`\n${result.stderr}\`\`\``,
            result.outputFiles.length > 0 && `Generated files: ${result.outputFiles.join(", ")}`,
          ]
            .filter(Boolean)
            .join("\n\n");
          const assistantMsg = `Python execution (exit code ${result.exitCode}):\n\n${resultMsg}`;
          session.messages.push({
            role: "assistant",
            content: assistantMsg,
            timestamp: new Date().toISOString(),
            files: result.outputFiles,
          });
          saveChatHistory(sessions);
          clearActiveSession(sessionId);
          socket.emit("chat:response", {
            sessionId,
            content: assistantMsg,
            done: true,
            files: result.outputFiles,
          });
          return;
        }

        // Build multimodal content for images
        const chatMessages = session.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        if (images && images.length > 0) {
          const lastIdx = chatMessages.length - 1;
          const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
            { type: "text", text: chatMessages[lastIdx].content as string },
          ];
          for (const img of images) {
            try {
              const imgPath = path.resolve(img.path);
              let imgBuffer = fs.readFileSync(imgPath);
              let mimeType = img.type || "image/png";
              const MAX_SIZE = 4 * 1024 * 1024;
              if (imgBuffer.length > MAX_SIZE) {
                try {
                  const tmpOut = `/tmp/clawcowork_resized_${Date.now()}.jpg`;
                  execSync(
                    `python3 -c "from PIL import Image; img = Image.open('${imgPath.replace(/'/g, "\\'")}'); img.thumbnail((1600, 1600), Image.LANCZOS); img = img.convert('RGB'); img.save('${tmpOut}', 'JPEG', quality=80)"`,
                    { timeout: 10000 }
                  );
                  imgBuffer = fs.readFileSync(tmpOut);
                  mimeType = "image/jpeg";
                  fs.unlinkSync(tmpOut);
                } catch {}
              }
              contentParts.push({
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${imgBuffer.toString("base64")}` },
              });
            } catch {}
          }
          (chatMessages[lastIdx] as any).content = contentParts;
        }

        const controller = new AbortController();
        activeAgentSessions.set(sessionId, {
          status: "thinking",
          title: session.title,
          startedAt: new Date().toISOString(),
          controller,
        });
        emitStatus(socket, sessionId, { status: "thinking" });
        const outputFiles: string[] = [];

        try {
          const result = await runAgentLoop(chatMessages, buildMainSystemPrompt(), {
            onToolCall: (name, args) => {
              emitStatus(socket, sessionId, { status: "tool_call", tool: name, args });
            },
            onToolResult: (name, toolResult) => {
              emitStatus(socket, sessionId, { status: "tool_result", tool: name });
              if (toolResult?.outputFiles) outputFiles.push(...toolResult.outputFiles);
            },
            signal: controller.signal,
          });

          if (result.content) {
            socket.emit("chat:chunk", { sessionId, content: "\n" + result.content });
          }

          const fullResponse =
            result.content +
            (outputFiles.length > 0 ? `\n\nGenerated files: ${outputFiles.join(", ")}` : "");

          session.messages.push({
            role: "assistant",
            content: fullResponse,
            timestamp: new Date().toISOString(),
            files: outputFiles.length > 0 ? outputFiles : undefined,
          });
          saveChatHistory(sessions);
          clearActiveSession(sessionId);
          socket.emit("chat:response", {
            sessionId,
            content: fullResponse,
            done: true,
            files: outputFiles.length > 0 ? outputFiles : undefined,
          });
        } catch (err: any) {
          try {
            const result = await callAgent(chatMessages, buildMainSystemPrompt());
            const fallback =
              result.content +
              (outputFiles.length > 0 ? `\n\nGenerated files: ${outputFiles.join(", ")}` : "");
            session.messages.push({
              role: "assistant",
              content: fallback,
              timestamp: new Date().toISOString(),
              files: outputFiles.length > 0 ? outputFiles : undefined,
            });
            saveChatHistory(sessions);
            clearActiveSession(sessionId);
            socket.emit("chat:response", {
              sessionId,
              content: fallback,
              done: true,
              files: outputFiles.length > 0 ? outputFiles : undefined,
            });
          } catch (fallbackErr: any) {
            const errMsg = `Error: ${fallbackErr.message || err.message}`;
            session.messages.push({ role: "assistant", content: errMsg, timestamp: new Date().toISOString() });
            saveChatHistory(sessions);
            clearActiveSession(sessionId);
            socket.emit("chat:response", { sessionId, content: errMsg, done: true });
          }
        }
      }
    );

    // ─── Project Chat ────────────────────────────────────────────────────────
    socket.on(
      "project:chat:send",
      async (data: {
        projectId: string;
        sessionId: string;
        message: string;
        images?: { path: string; type: string }[];
      }) => {
        const { projectId, sessionId, message, images } = data;
        const projects = getProjects();
        const project = projects.find((p) => p.id === projectId);
        if (!project) {
          socket.emit("chat:response", { sessionId, content: "Error: Project not found", done: true });
          return;
        }

        // Build project-aware workspace info
        let workspaceInfo = "";
        if (project.workingFolder) {
          workspaceInfo = `Project working folder: ${project.workingFolder}\nWhen the user asks about files, search this folder first. Use this path for reading/writing project files.`;
        }

        // Read project memory
        let projectMemory = "";
        if (project.workingFolder) {
          const memPath = path.join(project.workingFolder, "memory.md");
          try {
            if (fs.existsSync(memPath)) projectMemory = fs.readFileSync(memPath, "utf-8");
          } catch {}
        }
        if (!projectMemory && project.memory) projectMemory = project.memory;

        let projectContext = "";
        if (projectMemory) {
          projectContext += `--- PROJECT MEMORY ---\nProject: "${project.name}"\n\n${projectMemory}\n--- END MEMORY ---\n`;
        }
        if (project.description) {
          projectContext += `\nProject description: ${project.description}`;
        }
        if (project.skills?.length > 0) {
          const allSkills = getSkills();
          const selected = allSkills.filter((s) => project.skills.includes(s.id));
          if (selected.length > 0) {
            projectContext += `\nProject priority skills: ${selected.map((s) => s.name).join(", ")}`;
          }
        }
        projectContext += `\n\nIMPORTANT: If the user shares project info (tech stack, decisions, conventions), suggest recording it to the project memory.`;

        const systemPrompt = buildMainSystemPrompt({ workspaceInfo, projectContext });

        const sessions = getChatHistory();
        let session = sessions.find((s) => s.id === sessionId);
        if (!session) {
          session = {
            id: sessionId,
            title: `[${project.name}] ${message.slice(0, 40)}`,
            messages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          sessions.push(session);
        }

        session.messages.push({ role: "user", content: message, timestamp: new Date().toISOString() });
        session.updatedAt = new Date().toISOString();
        saveChatHistory(sessions);

        const chatMessages = session.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        if (images && images.length > 0) {
          const lastIdx = chatMessages.length - 1;
          const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
            { type: "text", text: chatMessages[lastIdx].content as string },
          ];
          for (const img of images) {
            try {
              const imgPath = path.resolve(img.path);
              let imgBuffer = fs.readFileSync(imgPath);
              let mimeType = img.type || "image/png";
              const MAX_SIZE = 4 * 1024 * 1024;
              if (imgBuffer.length > MAX_SIZE) {
                try {
                  const tmpOut = `/tmp/clawcowork_resized_${Date.now()}.jpg`;
                  execSync(
                    `python3 -c "from PIL import Image; img = Image.open('${imgPath.replace(/'/g, "\\'")}'); img.thumbnail((1600, 1600), Image.LANCZOS); img = img.convert('RGB'); img.save('${tmpOut}', 'JPEG', quality=80)"`,
                    { timeout: 10000 }
                  );
                  imgBuffer = fs.readFileSync(tmpOut);
                  mimeType = "image/jpeg";
                  fs.unlinkSync(tmpOut);
                } catch {}
              }
              contentParts.push({
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${imgBuffer.toString("base64")}` },
              });
            } catch {}
          }
          (chatMessages[lastIdx] as any).content = contentParts;
        }

        const controller = new AbortController();
        activeAgentSessions.set(sessionId, {
          status: "thinking",
          title: session.title,
          startedAt: new Date().toISOString(),
          controller,
        });
        emitStatus(socket, sessionId, { status: "thinking" });
        const outputFiles: string[] = [];

        try {
          const result = await runAgentLoop(chatMessages, systemPrompt, {
            onToolCall: (name, args) => {
              emitStatus(socket, sessionId, { status: "tool_call", tool: name, args });
            },
            onToolResult: (name, toolResult) => {
              emitStatus(socket, sessionId, { status: "tool_result", tool: name });
              if (toolResult?.outputFiles) outputFiles.push(...toolResult.outputFiles);
            },
            signal: controller.signal,
          });

          if (result.content) {
            socket.emit("chat:chunk", { sessionId, content: "\n" + result.content });
          }

          const fullResponse =
            result.content +
            (outputFiles.length > 0 ? `\n\nGenerated files: ${outputFiles.join(", ")}` : "");

          session.messages.push({
            role: "assistant",
            content: fullResponse,
            timestamp: new Date().toISOString(),
            files: outputFiles.length > 0 ? outputFiles : undefined,
          });
          saveChatHistory(sessions);
          clearActiveSession(sessionId);
          socket.emit("chat:response", {
            sessionId,
            content: fullResponse,
            done: true,
            files: outputFiles.length > 0 ? outputFiles : undefined,
          });
        } catch (err: any) {
          try {
            const result = await callAgent(chatMessages, systemPrompt);
            const fallback =
              result.content +
              (outputFiles.length > 0 ? `\n\nGenerated files: ${outputFiles.join(", ")}` : "");
            session.messages.push({
              role: "assistant",
              content: fallback,
              timestamp: new Date().toISOString(),
              files: outputFiles.length > 0 ? outputFiles : undefined,
            });
            saveChatHistory(sessions);
            clearActiveSession(sessionId);
            socket.emit("chat:response", {
              sessionId,
              content: fallback,
              done: true,
              files: outputFiles.length > 0 ? outputFiles : undefined,
            });
          } catch (fallbackErr: any) {
            const errMsg = `Error: ${fallbackErr.message || err.message}`;
            session.messages.push({ role: "assistant", content: errMsg, timestamp: new Date().toISOString() });
            saveChatHistory(sessions);
            clearActiveSession(sessionId);
            socket.emit("chat:response", { sessionId, content: errMsg, done: true });
          }
        }
      }
    );

    socket.on("python:run", async (data: { code: string }) => {
      const settings = getSettings();
      const sandboxDir = settings.sandboxDir || path.resolve("sandbox");
      socket.emit("python:status", { status: "running" });
      const result = await runPython(data.code, sandboxDir);
      socket.emit("python:result", result);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });
}
