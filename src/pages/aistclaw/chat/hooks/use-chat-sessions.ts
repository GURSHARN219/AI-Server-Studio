import { useState, useEffect, useCallback } from "react";
import { useWs } from "@aistclaw/hooks/use-ws";
import { useWsEvent } from "@aistclaw/hooks/use-ws-event";
import { Methods, Events } from "@aistclaw/api/protocol";
import type { SessionInfo } from "@aistclaw/types/session";
import { useAuthStore } from "@aistclaw/stores/use-auth-store";
import { toast } from "@aistclaw/stores/use-toast-store";
import i18next from "i18next";
import { userFriendlyError } from "@aistclaw/lib/error-utils";
import { uniqueId } from "@aistclaw/lib/utils";

/**
 * Manages the session list for the chat sidebar.
 * Loads sessions for the selected agent, supports creating new sessions.
 */
export function useChatSessions(agentId: string) {
  const ws = useWs();
  const connected = useAuthStore((s) => s.connected);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await ws.call<{ sessions: SessionInfo[] }>(
        Methods.SESSIONS_LIST,
        { agentId, channel: "ws" },
      );
      const sorted = (res.sessions ?? []).sort(
        (a: SessionInfo, b: SessionInfo) =>
          new Date(b.updated).getTime() - new Date(a.updated).getTime(),
      );
      setSessions(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [ws, agentId, connected]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const buildNewSessionKey = useCallback(() => {
    const convId = uniqueId();
    return `agent:${agentId}:ws:direct:${convId}`;
  }, [agentId]);

  const deleteSession = useCallback(async (key: string) => {
    if (!connected) return;
    try {
      await ws.call(Methods.SESSIONS_DELETE, { key });
      await loadSessions();
      toast.success(i18next.t("sessions:toast.deleted"));
    } catch (err) {
      toast.error(i18next.t("sessions:toast.deleteFailed"), userFriendlyError(err));
      throw err;
    }
  }, [ws, connected, loadSessions]);

  // Update session label in-place when backend generates a title.
  const handleSessionUpdated = useCallback((payload: unknown) => {
    const event = payload as { sessionKey?: string; label?: string };
    if (!event?.sessionKey || !event?.label) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.key === event.sessionKey ? { ...s, label: event.label } : s,
      ),
    );
  }, []);
  useWsEvent(Events.SESSION_UPDATED, handleSessionUpdated);

  return {
    sessions,
    loading,
    error,
    refresh: loadSessions,
    buildNewSessionKey,
    deleteSession,
  };
}
