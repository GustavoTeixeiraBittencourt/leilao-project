import { syncServerClock } from "../lib/clock";
import { apiFetch } from "./client";

export type LotPhase = "scheduled" | "live" | "ended" | "cancelled";

export type Lot = {
  id: string;
  title: string;
  imageUrl: string | null;
  // Snapshot do item do museu guardado no lote (a API externa nunca é consultada de novo).
  attributes: {
    artist_display?: string | null;
    date_display?: string | null;
    medium_display?: string | null;
    dimensions?: string | null;
    credit_line?: string | null;
    is_public_domain?: boolean;
    main_reference_number?: string | null;
  };
  startingBidCents: number;
  minIncrementCents: number;
  startsAt: string;
  endsAt: string;
  status: "open" | "closed" | "cancelled";
  phase: LotPhase;
  currentBidCents: number | null;
  bidCount: number;
  leaderAlias: string | null;
  winnerAlias: string | null;
  finalPriceCents: number | null;
  serverNow: string;
};

export type ListedPhase = "live" | "scheduled" | "ended";

export type LotCounts = Record<ListedPhase, number>;

export type LotList = {
  lots: Lot[];
  counts: LotCounts;
  serverNow: string;
};

export function fetchLots(params: { phase: ListedPhase; q?: string; limit?: number }) {
  const search = new URLSearchParams({ phase: params.phase, limit: String(params.limit ?? 20) });
  if (params.q) search.set("q", params.q);
  return apiFetch<LotList>(`/lots?${search.toString()}`);
}

export const lotQueryKey = (lotId: string) => ["lot", lotId] as const;

// `lot.serverNow` vem aninhado (não no topo da resposta), então o relógio do servidor
// é recalibrado aqui, e não pelo apiFetch.
export async function fetchLot(lotId: string): Promise<Lot> {
  const { lot } = await apiFetch<{ lot: Lot }>(`/lots/${lotId}`);
  syncServerClock(lot.serverNow);
  return lot;
}

// Chave única por (fase, busca, limite): a Vitrine usa a mesma chave para o herói e
// para a lista principal, então o React Query faz UMA chamada quando coincidem.
export const lotsQueryKey = (phase: ListedPhase, q: string, limit: number) => ["lots", phase, q, limit] as const;
