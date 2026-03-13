import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { getAccessToken } from "../utils/api";

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    const socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
      auth: { token },
    });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    return () => { socket.disconnect(); };
  }, []);

  const sendMessage = useCallback((sessionId: string, message: string, images?: { path: string; type: string }[]) => {
    socketRef.current?.emit("chat:send", { sessionId, message, images });
  }, []);

  const sendProjectMessage = useCallback((projectId: string, sessionId: string, message: string, images?: { path: string; type: string }[]) => {
    socketRef.current?.emit("project:chat:send", { projectId, sessionId, message, images });
  }, []);

  const onChunk = useCallback((cb: (data: { sessionId: string; content: string }) => void) => {
    socketRef.current?.on("chat:chunk", cb);
    return () => { socketRef.current?.off("chat:chunk", cb); };
  }, []);

  const onResponse = useCallback((cb: (data: { sessionId: string; content: string; done: boolean; files?: string[] }) => void) => {
    socketRef.current?.on("chat:response", cb);
    return () => { socketRef.current?.off("chat:response", cb); };
  }, []);

  const onStatus = useCallback((cb: (data: { status: string; sessionId?: string; tool?: string }) => void) => {
    socketRef.current?.on("chat:status", cb);
    return () => { socketRef.current?.off("chat:status", cb); };
  }, []);

  const onActiveSessions = useCallback((cb: (data: Record<string, { status: string; tool?: string }>) => void) => {
    socketRef.current?.on("chat:active_sessions", cb);
    return () => { socketRef.current?.off("chat:active_sessions", cb); };
  }, []);

  return { connected, sendMessage, sendProjectMessage, onChunk, onResponse, onStatus, onActiveSessions, socket: socketRef };
}
