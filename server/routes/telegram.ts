import { Router } from "express";
import { getSettings, saveSettings } from "../services/data";
import {
  connectTelegram,
  disconnectTelegram,
  getLastChatId,
  getTelegramStatus,
  sendTelegramMessage,
} from "../services/telegram";

export const telegramRouter = Router();

telegramRouter.get("/status", (_req, res) => {
  res.json(getTelegramStatus());
});

telegramRouter.post("/connect", async (req, res) => {
  const { token } = req.body;
  const botToken = token || getSettings().telegramBotToken;
  if (!botToken) return res.status(400).json({ ok: false, error: "Bot token required" });
  const result = await connectTelegram(botToken);
  res.json(result);
});

telegramRouter.post("/disconnect", (_req, res) => {
  disconnectTelegram();
  res.json({ ok: true });
});

// Returns the last chat ID seen by the polling loop (or from settings)
telegramRouter.post("/detect-chat-id", (req, res) => {
  const found = getLastChatId();
  if (found) {
    // Also make sure it's saved to settings
    const settings = getSettings();
    if (settings.telegramChatId !== found.chatId) {
      saveSettings({ ...settings, telegramChatId: found.chatId });
    }
    return res.json({ ok: true, chatId: found.chatId, username: found.username });
  }
  res.json({
    ok: false,
    error: "No message received yet. Open your bot in Telegram and send any message (e.g. /start), then click Detect again.",
  });
});

telegramRouter.post("/send", async (req, res) => {
  const { text, chatId } = req.body;
  const settings = getSettings();
  const token = settings.telegramBotToken;
  const target = chatId || settings.telegramChatId;
  if (!token) return res.status(400).json({ ok: false, error: "Bot token not configured" });
  if (!target) return res.status(400).json({ ok: false, error: "Chat ID not set — use Detect my Chat ID first" });
  if (!text) return res.status(400).json({ ok: false, error: "text required" });
  const result = await sendTelegramMessage(token, target, text);
  res.json(result);
});
