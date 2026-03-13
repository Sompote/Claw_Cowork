import { getSettings, saveSettings, getChatHistory, saveChatHistory } from "./data";
import { runAgentLoop, callAgent, buildSystemPrompt } from "./agent";
import { getActiveAgentSessions, registerActiveSession, unregisterActiveSession } from "./socket";

const TELEGRAM_API = "https://api.telegram.org/bot";

interface TelegramStatus {
  connected: boolean;
  botInfo: { id: number; username: string; first_name: string } | null;
  lastChatId?: string;
  lastChatUsername?: string;
}

let state: TelegramStatus = { connected: false, botInfo: null };
let pollingActive = false;
let lastUpdateId = 0;
let currentToken = "";

export function getTelegramStatus(): TelegramStatus {
  return { ...state };
}

export async function connectTelegram(
  token: string
): Promise<{ ok: boolean; botInfo?: any; error?: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API}${token}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.ok) {
      return { ok: false, error: data.description || "Invalid token" };
    }
    state = { connected: true, botInfo: data.result };
    currentToken = token;

    // Restore last known chat from settings
    const settings = getSettings();
    if (settings.telegramChatId) {
      state.lastChatId = settings.telegramChatId;
      state.lastChatUsername = settings.telegramChatId;
    }

    if (!pollingActive) startPolling(token);
    return { ok: true, botInfo: data.result };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export function disconnectTelegram(): void {
  state = { connected: false, botInfo: null };
  pollingActive = false;
  currentToken = "";
  lastUpdateId = 0;
}

export function getLastChatId(): { chatId: string; username: string } | null {
  if (state.lastChatId) {
    return { chatId: state.lastChatId, username: state.lastChatUsername || state.lastChatId };
  }
  const settings = getSettings();
  if (settings.telegramChatId) {
    return { chatId: settings.telegramChatId, username: settings.telegramChatId };
  }
  return null;
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.ok) {
      let hint = "";
      if (data.description?.includes("chat not found")) {
        hint = " — open @" + (state.botInfo?.username || "your bot") + " in Telegram and send /start first";
      } else if (data.description?.includes("bot was blocked")) {
        hint = " — you blocked the bot; unblock it in Telegram first";
      }
      return { ok: false, error: data.description + hint };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

function handleIncomingUpdate(update: any): void {
  const msg = update.message || update.channel_post;
  if (!msg?.chat?.id) return;
  // Only handle text messages
  if (!msg.text) return;

  const chatId = String(msg.chat.id);
  const username =
    msg.from?.username ||
    msg.chat?.username ||
    msg.chat?.title ||
    msg.from?.first_name ||
    chatId;

  // Save to state
  state.lastChatId = chatId;
  state.lastChatUsername = username;

  // Auto-save to settings
  try {
    const settings = getSettings();
    if (!settings.telegramChatId || settings.telegramChatId !== chatId) {
      saveSettings({ ...settings, telegramChatId: chatId });
    }
  } catch {}

  console.log(`[Telegram] @${username} (${chatId}): ${msg.text}`);

  // Run agent and reply — fire-and-forget
  replyToTelegramMessage(chatId, msg.text, username).catch((err) => {
    console.error("[Telegram] reply error:", err.message);
  });
}

async function replyToTelegramMessage(chatId: string, text: string, username: string): Promise<void> {
  const token = currentToken;
  if (!token) return;

  // If this telegram session already has an agent task running, notify and bail
  const sessionId = `telegram_${chatId}`;
  const active = getActiveAgentSessions();
  if (active[sessionId]) {
    const statusLabel = active[sessionId].status === "tool_call" || active[sessionId].status === "tool_result"
      ? `using ${active[sessionId].tool || active[sessionId].status}`
      : active[sessionId].status;
    await sendTelegramMessage(token, chatId, `⏳ Still working on your previous request (${statusLabel}). Please wait...`);
    return;
  }

  // Maintain a per-chat session in chat history
  const sessions = getChatHistory();
  let session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    session = {
      id: sessionId,
      title: `Telegram: @${username}`,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sessions.push(session);
  }

  session.messages.push({ role: "user", content: text, timestamp: new Date().toISOString() });
  session.updatedAt = new Date().toISOString();
  saveChatHistory(sessions);

  const systemPrompt = buildSystemPrompt({ mode: "full" });
  const chatMessages = session.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const controller = new AbortController();
  registerActiveSession(sessionId, `Telegram: @${username}`, controller);

  // Immediately acknowledge so user knows we're working
  await sendTelegramMessage(token, chatId, "⏳ Thinking...");

  const toolLabels: Record<string, string> = {
    web_search: "Searching the web",
    fetch_url: "Fetching URL",
    run_python: "Running Python",
    run_react: "Running React",
    run_shell: "Running command",
    read_file: "Reading file",
    write_file: "Writing file",
    list_files: "Listing files",
    list_skills: "Listing skills",
    load_skill: "Loading skill",
    clawhub_search: "Searching ClawHub",
    clawhub_install: "Installing skill",
    spawn_subagent: "Spawning subagent",
  };

  try {
    let result;
    try {
      result = await runAgentLoop(chatMessages, systemPrompt, {
        signal: controller.signal,
        onToolCall: async (name: string) => {
          const label = toolLabels[name] || name;
          await sendTelegramMessage(token, chatId, `🔧 ${label}...`);
        },
      });
    } catch {
      result = await callAgent(chatMessages, systemPrompt);
    }

    const reply = result.content?.trim() || "Sorry, I could not generate a response.";

    session.messages.push({ role: "assistant", content: reply, timestamp: new Date().toISOString() });
    session.updatedAt = new Date().toISOString();
    saveChatHistory(sessions);

    // Split long replies (Telegram limit = 4096 chars)
    const chunks = splitMessage(reply, 4096);
    for (const chunk of chunks) {
      await sendTelegramMessage(token, chatId, chunk);
    }
  } catch (err: any) {
    console.error("[Telegram] agent error:", err.message);
    await sendTelegramMessage(token, chatId, `Error: ${err.message}`);
  } finally {
    unregisterActiveSession(sessionId);
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

async function startPolling(token: string): Promise<void> {
  pollingActive = true;
  // First do a quick no-wait sync to pick up any pending messages immediately
  try {
    const syncRes = await fetch(
      `${TELEGRAM_API}${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=0&limit=100`,
      { signal: AbortSignal.timeout(10000) }
    );
    const syncData = await syncRes.json();
    if (syncData.ok && syncData.result.length > 0) {
      for (const update of syncData.result) {
        lastUpdateId = update.update_id;
        handleIncomingUpdate(update);
      }
    }
  } catch {}

  // Long-poll loop
  while (pollingActive && state.connected && currentToken === token) {
    try {
      const res = await fetch(
        `${TELEGRAM_API}${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=25`,
        { signal: AbortSignal.timeout(35000) }
      );
      if (!res.ok) {
        await sleep(5000);
        continue;
      }
      const data = await res.json();
      if (!data.ok) {
        // 409 conflict or other error — back off
        await sleep(3000);
        continue;
      }
      if (data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          handleIncomingUpdate(update);
        }
      }
    } catch {
      if (pollingActive) await sleep(5000);
    }
  }
  pollingActive = false;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
