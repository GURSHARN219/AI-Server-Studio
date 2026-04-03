import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWs } from "@aistclaw/hooks/use-ws";
import { useAuthStore } from "@aistclaw/stores/use-auth-store";
import { Methods } from "@aistclaw/api/protocol";
import { queryKeys } from "@aistclaw/lib/query-keys";
import { toast } from "@aistclaw/stores/use-toast-store";
import i18n from "@aistclaw/i18n";
import { userFriendlyError } from "@aistclaw/lib/error-utils";

interface ConfigData {
  config: Record<string, unknown>;
  hash: string;
  path: string;
}

export function useConfig() {
  const ws = useWs();
  const connected = useAuthStore((s) => s.connected);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hashRef = useRef("");

  const { data, isPending: loading } = useQuery({
    queryKey: queryKeys.config.all,
    queryFn: async (): Promise<ConfigData> => {
      const res = await ws.call<ConfigData>(Methods.CONFIG_GET);
      hashRef.current = res.hash;
      return res;
    },
    staleTime: 5 * 60_000,
    enabled: connected,
  });

  const config = data?.config ?? null;
  const hash = data?.hash ?? "";
  const configPath = data?.path ?? "";

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.config.all }),
    [queryClient],
  );

  const applyRaw = useCallback(
    async (raw: string) => {
      setSaving(true);
      setError(null);
      try {
        const res = await ws.call<{ hash: string }>(Methods.CONFIG_APPLY, {
          raw,
          baseHash: hashRef.current,
        });
        hashRef.current = res.hash;
        await invalidate();
        toast.success(i18n.t("config:toast.saved"));
      } catch (err) {
        const msg = userFriendlyError(err);
        setError(msg);
        toast.error(i18n.t("config:toast.saveFailed"), msg);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [ws, invalidate],
  );

  const patch = useCallback(
    async (updates: Record<string, unknown>) => {
      setSaving(true);
      setError(null);
      try {
        const res = await ws.call<{ hash: string }>(Methods.CONFIG_PATCH, {
          raw: JSON.stringify(updates),
          baseHash: hashRef.current,
        });
        hashRef.current = res.hash;
        await invalidate();
        toast.success(i18n.t("config:toast.saved"));
      } catch (err) {
        const msg = userFriendlyError(err);
        setError(msg);
        toast.error(i18n.t("config:toast.saveFailed"), msg);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [ws, invalidate],
  );

  return { config, hash, configPath, loading, saving, error, refresh: invalidate, applyRaw, patch };
}
