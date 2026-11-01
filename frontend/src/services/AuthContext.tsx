import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api";

export interface User { id: number; name: string; email: string }

interface AuthValue {
  user: User | null;
  ready: boolean;
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthValue>(null as unknown as AuthValue);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.me().then((res) => setUser(res.user)).catch(() => setUser(null)).finally(() => setReady(true));
    // Any API call that finds the session gone sends the user back to sign in.
    const expired = () => setUser(null);
    window.addEventListener("riq:unauthenticated", expired);
    return () => window.removeEventListener("riq:unauthenticated", expired);
  }, []);

  const signIn = useCallback(async (email: string, password: string, remember: boolean) => {
    setUser(await api.login(email, password, remember));
  }, []);
  const register = useCallback(async (name: string, email: string, password: string) => {
    setUser(await api.register(name, email, password));
  }, []);
  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, ready, signIn, register, signOut, setUser }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}
