import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useHttp } from "@goclaw/hooks/use-ws";
import { useAuthStore } from "@goclaw/stores/use-auth-store";
import { queryKeys } from "@goclaw/lib/query-keys";

export interface RuntimeInfo {
  name: string;
  available: boolean;
  version?: string;
}

export interface RuntimeStatus {
  runtimes: RuntimeInfo[];
  ready: boolean;
}

export function usePackageRuntimes() {
  const http = useHttp();
  const connected = useAuthStore((s) => s.connected);

  const { data, isFetching: loading, refetch } = useQuery({
    queryKey: queryKeys.packages.runtimes,
    queryFn: () => http.get<RuntimeStatus>("/v1/packages/runtimes"),
    staleTime: 120_000,
    enabled: connected,
  });

  const refresh = useCallback(() => { refetch(); }, [refetch]);

  return { runtimes: data, loading, refresh };
}
