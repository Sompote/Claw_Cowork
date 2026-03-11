import crypto from "crypto";
import { getSettings, saveSettings } from "./data";

const GRACE_MS = 60 * 60 * 1000; // 1 hour

let CURRENT_TOKEN = "";
let PREV_TOKEN = "";
let TOKEN_ROTATED_AT: Date | null = null;

export function reloadTokenState(): void {
  const env = process.env.ACCESS_TOKEN || "";
  const settings = getSettings();
  CURRENT_TOKEN = settings.accessToken || env;
  PREV_TOKEN = settings.accessTokenPrev || "";
  TOKEN_ROTATED_AT = settings.accessTokenRotatedAt ? new Date(settings.accessTokenRotatedAt) : null;
}

export function hasTokenRequired(): boolean {
  return !!CURRENT_TOKEN;
}

export function isValidToken(provided: string | undefined): boolean {
  if (!provided) return false;
  if (!CURRENT_TOKEN) return true; // no token set — open access
  if (provided === CURRENT_TOKEN) return true;
  // Grace period: old token still valid for 1 hour after rotation
  if (PREV_TOKEN && provided === PREV_TOKEN && TOKEN_ROTATED_AT) {
    const ageMs = Date.now() - TOKEN_ROTATED_AT.getTime();
    if (ageMs < GRACE_MS) return true;
  }
  return false;
}

export function initToken(): void {
  const env = process.env.ACCESS_TOKEN || "";
  const settings = getSettings();
  if (!settings.accessToken && !env) {
    const newToken = crypto.randomBytes(32).toString("hex");
    saveSettings({
      ...settings,
      accessToken: newToken,
      accessTokenCreatedAt: new Date().toISOString(),
    });
    console.log("\n  Access token auto-generated:");
    console.log(`  ${newToken}`);
    console.log("  Store this securely. Find it anytime in Settings > Access Security.\n");
  }
  reloadTokenState();
}

export function rotateToken(): string {
  const settings = getSettings();
  const newToken = crypto.randomBytes(32).toString("hex");
  saveSettings({
    ...settings,
    accessTokenPrev: settings.accessToken || "",
    accessToken: newToken,
    accessTokenRotatedAt: new Date().toISOString(),
    accessTokenCreatedAt: settings.accessTokenCreatedAt || new Date().toISOString(),
  });
  reloadTokenState();
  return newToken;
}
