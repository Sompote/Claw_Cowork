import { useState, useEffect, ReactNode } from "react";
import { getAccessToken, setAccessToken } from "../utils/api";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [serverToken, setServerToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    checkAuth();
    fetch("/api/auth/token-hint")
      .then((r) => r.json())
      .then((d) => setServerToken(d.token || null))
      .catch(() => {});
  }, []);

  async function checkAuth() {
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: getAccessToken() }),
      });
      const data = await res.json();
      if (data.ok) {
        setAuthed(true);
      } else {
        setAuthed(false);
      }
    } catch {
      setAuthed(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.ok) {
        setAccessToken(token);
        setAuthed(true);
      } else {
        setError("Invalid access token");
      }
    } catch {
      setError("Connection failed");
    }
  }

  if (authed === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0f172a" }}>
        <div style={{ color: "#94a3b8", fontSize: "1.1rem" }}>Loading...</div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div style={{
        display: "flex", justifyContent: "center", alignItems: "center",
        height: "100vh", background: "#0f172a",
      }}>
        <form onSubmit={handleSubmit} style={{
          background: "#1e293b", borderRadius: 12, padding: "2.5rem",
          minWidth: 340, boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        }}>
          <h2 style={{ color: "#f1f5f9", margin: "0 0 0.5rem", fontSize: "1.4rem" }}>
            Claw Cowork
          </h2>
          <p style={{ color: "#64748b", margin: "0 0 1rem", fontSize: "0.9rem" }}>
            Enter access token to continue
          </p>
          {serverToken && (
            <div style={{
              background: "#0f172a", borderRadius: 8, padding: "12px 14px",
              marginBottom: "1.25rem",
            }}>
              <div style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: 6 }}>
                Your access token:
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code style={{
                  flex: 1, color: "#f1f5f9", fontSize: "0.78rem",
                  wordBreak: "break-all", lineHeight: 1.5,
                }}>
                  {serverToken}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(serverToken);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                    setToken(serverToken);
                  }}
                  style={{
                    flexShrink: 0, padding: "4px 10px", borderRadius: 6,
                    border: "1px solid #334155", background: "#1e293b",
                    color: "#94a3b8", fontSize: "0.75rem", cursor: "pointer",
                  }}
                >
                  {copied ? "Copied!" : "Copy & Fill"}
                </button>
              </div>
            </div>
          )}
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Access token"
            autoFocus
            style={{
              width: "100%", padding: "0.7rem 0.9rem", borderRadius: 8,
              border: "1px solid #334155", background: "#0f172a",
              color: "#f1f5f9", fontSize: "1rem", outline: "none",
              boxSizing: "border-box",
            }}
          />
          {error && (
            <div style={{ color: "#f87171", fontSize: "0.85rem", marginTop: "0.5rem" }}>
              {error}
            </div>
          )}
          <button type="submit" style={{
            width: "100%", marginTop: "1rem", padding: "0.7rem",
            borderRadius: 8, border: "none", background: "#3b82f6",
            color: "#fff", fontSize: "1rem", cursor: "pointer",
            fontWeight: 600,
          }}>
            Enter
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
