import { syncServerClock } from "../lib/clock";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

const TOKEN_STORAGE_KEY = "leilao.token";

// localStorage pode lançar (modo privado, dados bloqueados): a app tem que funcionar
// sem sessão persistida, então toda leitura e escrita é protegida.
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    /* sem persistência: a sessão vale só até recarregar */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* nada a limpar */
  }
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 0,
  ) {
    super(message);
  }
}

// Quem precisa reagir a "sua sessão expirou" (AuthProvider) assina aqui; assim o
// cliente HTTP não conhece React.
const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // Servidor fora do ar, sem rede, CORS bloqueado: para o usuário é tudo "sem conexão".
    throw new ApiError("NETWORK_ERROR", "Network error");
  }

  const body: unknown = await response.json().catch(() => null);

  // Toda resposta que traz o relógio do servidor recalibra a contagem regressiva.
  if (typeof body === "object" && body !== null && "serverNow" in body && typeof body.serverNow === "string") {
    syncServerClock(body.serverNow);
  }

  if (!response.ok) {
    const error = (body ?? {}) as { code?: string; message?: string };
    const code = error.code ?? "UNKNOWN_ERROR";
    // Token inválido ou expirado numa chamada autenticada. INVALID_CREDENTIALS (senha
    // errada no login) também é 401, mas não é sessão expirada.
    if (response.status === 401 && code === "UNAUTHORIZED") {
      clearToken();
      unauthorizedListeners.forEach((listener) => listener());
    }
    throw new ApiError(code, error.message ?? "Unexpected error", response.status);
  }

  return body as T;
}
