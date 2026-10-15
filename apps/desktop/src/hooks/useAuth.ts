import { useState, useEffect, useRef } from "react";
import { hydrateAccountState } from "@/stores/accountState";
import {
  authBackendSession,
  authBackendSignOut,
  type BackendAuthUser,
} from "@/lib/api";

export function useAuth() {
  const [user, setUser] = useState<BackendAuthUser | null>(null);
  const [session, setSession] = useState<{ user: BackendAuthUser } | null>(null);
  const [loading, setLoading] = useState(true);
  const [stateError, setStateError] = useState<string | null>(null);
  const generation = useRef(0);

  const checkSession = async () => {
    const current = ++generation.current;
    setLoading(true);
    setStateError(null);
    const currentUser = await authBackendSession();
    if (current !== generation.current) return;
    try { await hydrateAccountState(currentUser?.id ?? null); }
    catch (error) { if (current === generation.current) setStateError(error instanceof Error ? error.message : "Could not load account state"); }
    if (current !== generation.current) return;
    setUser(currentUser);
    setSession(currentUser ? { user: currentUser } : null);
    setLoading(false);
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      await checkSession();
      if (!mounted) return;
    };
    run();
    const onChanged = () => {
      void run();
    };
    window.addEventListener("auth:changed", onChanged as EventListener);
    return () => {
      mounted = false;
      generation.current += 1;
      window.removeEventListener("auth:changed", onChanged as EventListener);
    };
  }, []);

  const signOut = async () => {
    await authBackendSignOut();
    setUser(null);
    setSession(null);
  };

  return { user, session, loading, stateError, signOut, checkSession };
}
