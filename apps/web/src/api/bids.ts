import { apiFetch } from "./client";
import type { Lot } from "./lots";

export type Bid = {
  seq: number;
  bidderAlias: string;
  amountCents: number;
  placedAt: string;
};

export type BidList = { bids: Bid[]; serverNow: string };

export const bidsQueryKey = (lotId: string) => ["bids", lotId] as const;

export function fetchBids(lotId: string) {
  return apiFetch<BidList>(`/lots/${lotId}/bids`);
}

export type PlaceBidResult = {
  bid: { seq: number; amountCents: number; placedAt: string };
  lot: Lot;
  wallet: { totalCents: number; committedCents: number; availableCents: number };
  // true quando o anti-sniping empurrou o encerramento neste lance.
  extended: boolean;
};

export function placeBid(lotId: string, amountCents: number) {
  return apiFetch<PlaceBidResult>(`/lots/${lotId}/bids`, {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });
}

// Eventos do SSE (`GET /lots/:id/events`). Espelham src/lib/events.ts da API.
export type BidPlacedEvent = {
  type: "bid_placed";
  lotId: string;
  bid: Bid;
  currentBidCents: number;
  bidCount: number;
  leaderAlias: string;
  endsAt: string;
  extended: boolean;
  serverNow: string;
};

export type LotClosedEvent = {
  type: "lot_closed";
  lotId: string;
  winnerAlias: string | null;
  finalPriceCents: number | null;
  closedAt: string;
  serverNow: string;
};

export type LotCancelledEvent = {
  type: "lot_cancelled";
  lotId: string;
  serverNow: string;
};
