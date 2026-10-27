import { apiFetch } from "./client";
import type { LotPhase } from "./lots";

// Espelha a resposta de GET /audit/lots/:id (apps/api/src/modules/audit/service.ts).
export type BreakReason =
  | "SEQ_GAP"
  | "PREV_HASH_MISMATCH"
  | "HASH_MISMATCH"
  | "BID_COUNT_MISMATCH"
  | "LOT_SUMMARY_MISMATCH"
  | "SEAL_MISMATCH"
  | "RECEIPT_MISMATCH";

export type AuditBid = {
  seq: number;
  bidderAlias: string;
  amountCents: number;
  placedAt: string;
  prevHash: string;
  hash: string;
};

export type AuditResult = {
  verdict: "intact" | "tampered";
  firstBreak: { seq: number; reason: BreakReason } | null;
  sealed: boolean;
  checkedBids: number;
  lot: {
    id: string;
    title: string;
    imageUrl: string | null;
    status: "open" | "closed" | "cancelled";
    phase: LotPhase;
    startsAt: string;
    endsAt: string;
    startingBidCents: number;
    minIncrementCents: number;
    bidCount: number;
    currentBidCents: number | null;
    finalPriceCents: number | null;
    winnerAlias: string | null;
  };
  // Só existe em lote encerrado.
  seal: { count: number | null; hash: string | null } | null;
  bids: AuditBid[];
  serverNow: string;
};

export const auditQueryKey = (lotId: string) => ["audit", lotId] as const;

export function fetchAudit(lotId: string) {
  return apiFetch<AuditResult>(`/audit/lots/${lotId}`);
}
