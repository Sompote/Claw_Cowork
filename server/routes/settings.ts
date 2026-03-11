import { Router } from "express";
import { getSettings, saveSettings } from "../services/data";
import { connectServer, disconnectServer, getMcpStatus, initMcpServers } from "../services/mcp";
import { rotateToken as doRotate } from "../services/tokenState";

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  const settings = getSettings();
  const masked = { ...settings };
  // Mask sensitive keys
  if (masked.apiKey) {
    masked.apiKey = masked.apiKey.slice(0, 8) + "..." + masked.apiKey.slice(-4);
  }
  if (masked.webSearchApiKey) {
    masked.webSearchApiKey = masked.webSearchApiKey.slice(0, 8) + "..." + masked.webSearchApiKey.slice(-4);
  }
  if (masked.openRouterSearchApiKey) {
    masked.openRouterSearchApiKey =
      masked.openRouterSearchApiKey.slice(0, 8) + "..." + masked.openRouterSearchApiKey.slice(-4);
  }
  if (masked.telegramBotToken && masked.telegramBotToken.length > 12) {
    masked.telegramBotToken = masked.telegramBotToken.slice(0, 8) + "..." + masked.telegramBotToken.slice(-4);
  }
  res.json(masked);
});

settingsRouter.put("/", (req, res) => {
  const current = getSettings();
  const updated = { ...current, ...req.body };
  // Don't overwrite masked values
  if (req.body.apiKey?.includes("...")) updated.apiKey = current.apiKey;
  if (req.body.webSearchApiKey?.includes("...")) updated.webSearchApiKey = current.webSearchApiKey;
  if (req.body.openRouterSearchApiKey?.includes("..."))
    updated.openRouterSearchApiKey = current.openRouterSearchApiKey;
  if (req.body.telegramBotToken?.includes("..."))
    updated.telegramBotToken = current.telegramBotToken;
  saveSettings(updated);
  res.json({ success: true });
});

function normalizeApiUrl(rawUrl: string): string {
  let url = rawUrl.trim().replace(/\/+$/, "");
  if (url.endsWith("/chat/completions")) return url;
  if (url.endsWith("/completions")) url = url.slice(0, -"/completions".length);
  if (url.endsWith("/chat")) url = url.slice(0, -"/chat".length);
  return url + "/chat/completions";
}

settingsRouter.post("/test-connection", async (req, res) => {
  const { apiKey, apiUrl, apiModel } = req.body;
  try {
    const url = normalizeApiUrl(apiUrl || "https://openrouter.ai/api/v1/chat/completions");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://claw-cowork.local",
        "X-Title": "Claw Cowork",
      },
      body: JSON.stringify({
        model: apiModel || "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 10,
      }),
    });
    if (response.ok) {
      res.json({ success: true, message: "Connection successful" });
    } else {
      let errDetail = "";
      try {
        const errJson = await response.json();
        errDetail = errJson?.error?.message || errJson?.message || JSON.stringify(errJson);
      } catch {
        errDetail = await response.text().catch(() => String(response.status));
      }
      const hint =
        response.status === 401 ? " (invalid API key)" :
        response.status === 404 ? ` (wrong URL: ${url})` :
        response.status === 400 ? " (bad request — check model name)" : "";
      res.json({ success: false, message: `Error ${response.status}${hint}: ${errDetail}` });
    }
  } catch (err: any) {
    res.json({ success: false, message: err.message });
  }
});

// MCP management
settingsRouter.get("/mcp/status", (_req, res) => {
  res.json(getMcpStatus());
});

settingsRouter.post("/mcp/connect", async (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: "name and url required" });
  const result = await connectServer({ name, url, enabled: true });
  res.json(result);
});

settingsRouter.post("/mcp/disconnect", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  await disconnectServer(name);
  res.json({ ok: true });
});

settingsRouter.post("/mcp/reconnect-all", async (_req, res) => {
  await initMcpServers();
  res.json({ ok: true, status: getMcpStatus() });
});

// Token info (masked)
settingsRouter.get("/token-info", (_req, res) => {
  const settings = getSettings();
  const envToken = process.env.ACCESS_TOKEN || "";
  const activeToken = settings.accessToken || envToken;
  const GRACE_MS = 60 * 60 * 1000;

  let gracePeriodActive = false;
  let graceExpiresInMin: number | null = null;
  if (settings.accessTokenRotatedAt) {
    const ageMs = Date.now() - new Date(settings.accessTokenRotatedAt).getTime();
    if (ageMs < GRACE_MS) {
      gracePeriodActive = true;
      graceExpiresInMin = Math.ceil((GRACE_MS - ageMs) / 60000);
    }
  }

  res.json({
    hasToken: !!activeToken,
    source: settings.accessToken ? "settings" : envToken ? "env" : "none",
    tokenPreview: activeToken ? activeToken.slice(0, 8) + "..." : null,
    createdAt: settings.accessTokenCreatedAt || null,
    rotatedAt: settings.accessTokenRotatedAt || null,
    gracePeriodActive,
    graceExpiresInMin,
  });
});

// Return full token (authenticated)
settingsRouter.get("/full-token", (_req, res) => {
  const settings = getSettings();
  const token = settings.accessToken || process.env.ACCESS_TOKEN || "";
  res.json({ token });
});

// Rotate token
settingsRouter.post("/rotate-token", (_req, res) => {
  const settings = getSettings();
  if (process.env.ACCESS_TOKEN && !settings.accessToken) {
    return res.status(400).json({ error: "Token is set via environment variable — change ACCESS_TOKEN env var to rotate." });
  }
  const newToken = doRotate();
  res.json({ ok: true, token: newToken });
});
