import { apiFetch } from "./client";

export type Role = "auctioneer" | "bidder";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  publicAlias: string;
};

type AuthResponse = { token: string; user: AuthUser };

export function signup(input: { email: string; password: string; displayName: string; role: Role }) {
  return apiFetch<AuthResponse>("/auth/signup", { method: "POST", body: JSON.stringify(input) });
}

export function login(input: { email: string; password: string }) {
  return apiFetch<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function fetchMe() {
  return apiFetch<{ user: AuthUser }>("/auth/me");
}

// Perfil: só o nome de exibição é editável (e-mail, papel e alias público não mudam).
export function updateProfile(displayName: string) {
  return apiFetch<{ user: AuthUser }>("/auth/me", { method: "PATCH", body: JSON.stringify({ displayName }) });
}

// 204 sem corpo. A senha atual errada volta como INVALID_CURRENT_PASSWORD (422, não 401).
export function changePassword(currentPassword: string, newPassword: string) {
  return apiFetch<null>("/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
}

export function fetchHealth() {
  return apiFetch<{ status: string; serverNow: string }>("/health");
}
