import { createContext, useContext, useState, type ReactNode } from "react";
import { clearToken, setToken } from "../api/client";
import { login as apiLogin, signup as apiSignup, type AuthUser, type Role } from "../api/auth";

type AuthContextValue = {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string, role: Role) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  async function login(email: string, password: string) {
    const result = await apiLogin({ email, password });
    setToken(result.token);
    setUser(result.user);
  }

  async function signup(email: string, password: string, displayName: string, role: Role) {
    const result = await apiSignup({ email, password, displayName, role });
    setToken(result.token);
    setUser(result.user);
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
