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

export function fetchHealth() {
  return apiFetch<{ status: string; serverNow: string }>("/health");
}
