import { syncServerClock } from "../lib/clock";
import { apiFetch } from "./client";
import type { LotPhase } from "./lots";

// Espelha GET /me/wins (apps/api/src/modules/me/routes.ts). Só aparecem lotes JÁ
// liquidados: a liquidação (débito, crédito e comprovante) acontece numa única
// transação, então não existe "arrematado mas sem comprovante".
export type Win = {
  receiptToken: string;
  lotId: string;
  title: string;
  imageUrl: string | null;
  amountCents: number;
  issuedAt: string;
};

export const winsQueryKey = ["wins"] as const;

export async function fetchWins(): Promise<Win[]> {
  const { wins } = await apiFetch<{ wins: Win[] }>("/me/wins");
  return wins;
}

// Espelha GET /me/bids: todos os lotes em que dei lance, um item por lote. A situação é
// calculada no servidor (líder/vencedor), o cliente só a exibe.
export type BidStatus = "leading" | "outbid" | "won" | "lost";

export type MyBid = {
  lotId: string;
  title: string;
  imageUrl: string | null;
  phase: LotPhase;
  endsAt: string;
  status: BidStatus;
  myHighestBidCents: number;
  myBidCount: number;
  // Lote aberto: lance atual. Lote fechado: valor final.
  currentBidCents: number | null;
  // Só nos lotes que arrematei.
  receiptToken: string | null;
  issuedAt: string | null;
  lastBidAt: string;
};

export const myBidsQueryKey = ["my-bids"] as const;

export async function fetchMyBids(): Promise<MyBid[]> {
  const { bids, serverNow } = await apiFetch<{ bids: MyBid[]; serverNow: string }>("/me/bids");
  syncServerClock(serverNow);
  return bids;
}
