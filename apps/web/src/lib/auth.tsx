"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  loginRequest,
  logoutRequest,
  refreshSession,
  setSessionLostHandler,
  type SessionBusiness,
  type SessionPayload,
  type SessionUser,
} from "./api";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthState {
  status: Status;
  user: SessionUser | null;
  business: SessionBusiness | null;
  can: (privilege: string) => boolean;
  login: (email: string, password: string) => Promise<SessionPayload>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [business, setBusiness] = useState<SessionBusiness | null>(null);

  const apply = useCallback((payload: SessionPayload | null) => {
    setUser(payload?.user ?? null);
    setBusiness(payload?.business ?? null);
    setStatus(payload ? "authenticated" : "anonymous");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSessionLostHandler(() => apply(null));
    refreshSession()
      .then((r) => !cancelled && apply(r.ok && r.data ? r.data : null))
      .catch(() => !cancelled && apply(null));
    return () => {
      cancelled = true;
      setSessionLostHandler(null);
    };
  }, [apply]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      business,
      can: (privilege) => Boolean(user?.privileges.includes(privilege)),
      login: async (email, password) => {
        const payload = await loginRequest(email, password);
        apply(payload);
        return payload;
      },
      logout: async () => {
        await logoutRequest();
        apply(null);
      },
    }),
    [status, user, business, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
};
