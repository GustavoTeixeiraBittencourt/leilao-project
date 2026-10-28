import { apiFetch } from "./client";

export type WalletEntryKind = "deposit" | "settlement_debit" | "settlement_credit" | "refund";

export type WalletEntry = {
  id: string;
  kind: WalletEntryKind;
  amountCents: number;
  lotId: string | null;
  createdAt: string;
};

// Situação de um lance meu. Não é lançamento do ledger: lance só reserva valor.
export type WalletBidStatus = "leading" | "outbid" | "won";

export type WalletBid = {
  id: string;
  lotId: string;
  lotTitle: string;
  amountCents: number;
  placedAt: string;
  status: WalletBidStatus;
};

export type Wallet = {
  totalCents: number;
  committedCents: number;
  availableCents: number;
  entries: WalletEntry[];
  bids: WalletBid[];
  serverNow: string;
};

export const walletQueryKey = ["wallet"] as const;

export function fetchWallet() {
  return apiFetch<Wallet>("/wallet");
}

export function deposit(amountCents: number) {
  return apiFetch<Omit<Wallet, "entries" | "bids">>("/wallet/deposit", {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });
}
