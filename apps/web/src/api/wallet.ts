import { apiFetch } from "./client";

export type WalletEntryKind = "deposit" | "settlement_debit" | "settlement_credit" | "refund";

export type WalletEntry = {
  id: string;
  kind: WalletEntryKind;
  amountCents: number;
  lotId: string | null;
  createdAt: string;
};

export type Wallet = {
  totalCents: number;
  committedCents: number;
  availableCents: number;
  entries: WalletEntry[];
  serverNow: string;
};

export const walletQueryKey = ["wallet"] as const;

export function fetchWallet() {
  return apiFetch<Wallet>("/wallet");
}

export function deposit(amountCents: number) {
  return apiFetch<Omit<Wallet, "entries">>("/wallet/deposit", {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });
}
