import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, clearToken, getToken, onUnauthorized, setToken } from "../api/client";
import { fetchMe, login as apiLogin, signup as apiSignup, type AuthUser, type Role } from "../api/auth";

type AuthContextValue = {
  user: AuthUser | null;
  // "loading" enquanto a sessão guardada está sendo conferida no servidor. As rotas
  // protegidas esperam isto, senão um usuário logado seria mandado ao /login a cada reload.
  status: "loading" | "ready";
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string, role: Role) => Promise<void>;
  logout: () => void;
  // Troca o usuário em memória (ex.: depois de editar o nome no perfil), para o cabeçalho
  // e o resto da app refletirem a mudança sem recarregar nem refazer login.
  updateUser: (user: AuthUser) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>(() => (getToken() ? "loading" : "ready"));

  // Restaura a sessão: o token vive no localStorage, mas o usuário (papel, alias)
  // vem sempre do servidor, que revalida o papel.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    fetchMe()
      .then(({ user }) => !cancelled && setUser(user))
      .catch((error: unknown) => {
        // Token inválido: limpa. Falha de rede: mantém o token e segue deslogado.
        if (error instanceof ApiError && error.status === 401) clearToken();
      })
      .finally(() => !cancelled && setStatus("ready"));
    return () => {
      cancelled = true;
    };
  }, []);

  // Uma chamada autenticada recebeu 401 (token expirado ou revogado).
  useEffect(
    () =>
      onUnauthorized(() => {
        setUser(null);
        queryClient.clear();
      }),
    [queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await apiLogin({ email, password });
      queryClient.clear(); // nada da sessão anterior pode vazar para a nova
      setToken(result.token);
      setUser(result.user);
    },
    [queryClient],
  );

  const signup = useCallback(
    async (email: string, password: string, displayName: string, role: Role) => {
      const result = await apiSignup({ email, password, displayName, role });
      queryClient.clear();
      setToken(result.token);
      setUser(result.user);
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const updateUser = useCallback((next: AuthUser) => setUser(next), []);

  const value = useMemo(
    () => ({ user, status, login, signup, logout, updateUser }),
    [user, status, login, signup, logout, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
