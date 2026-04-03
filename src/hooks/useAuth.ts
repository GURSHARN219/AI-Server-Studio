import { useState, useEffect } from "react";
import {
  authBackendSession,
  authBackendSignOut,
  type BackendAuthUser,
} from "@/lib/api";

export function useAuth() {
  const [user, setUser] = useState<BackendAuthUser | null>(null);
  const [session, setSession] = useState<{ user: BackendAuthUser } | null>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = async () => {
    setLoading(true);
    const currentUser = await authBackendSession();
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
      window.removeEventListener("auth:changed", onChanged as EventListener);
    };
  }, []);

  const signOut = async () => {
    await authBackendSignOut();
    setUser(null);
    setSession(null);
  };

  return { user, session, loading, signOut, checkSession };
}
