import { apiFetch } from "./client";
import type { Lot } from "./lots";

// Espelha GET /me/auctions (apps/api/src/modules/me/routes.ts): todos os lotes do
// leiloeiro, em qualquer fase (inclusive cancelados, que só aparecem aqui).
export type MyLot = Lot & {
  sold: boolean;
  closedAt: string | null;
  // Espelha a regra do servidor (aberto, não terminou, sem lances). Quem decide de
  // verdade é POST /lots/:id/cancel.
  canCancel: boolean;
};

export type MyAuctions = {
  lots: MyLot[];
  totalReceivedCents: number;
  serverNow: string;
};

export const myAuctionsQueryKey = ["my-auctions"] as const;

export function fetchMyAuctions() {
  return apiFetch<MyAuctions>("/me/auctions");
}

export function cancelLot(lotId: string) {
  return apiFetch<{ lot: Lot }>(`/lots/${lotId}/cancel`, { method: "POST" });
}

export type UpdateLotInput = Partial<{
  startingBidCents: number;
  minIncrementCents: number;
  startsAt: string;
  endsAt: string;
}>;

// PATCH /lots/:id: só lote do dono, aberto e sem lances (o servidor decide).
export function updateLot(lotId: string, input: UpdateLotInput) {
  return apiFetch<{ lot: Lot }>(`/lots/${lotId}`, { method: "PATCH", body: JSON.stringify(input) });
}

// Item da busca no acervo (GET /external/artworks). `attributes` é o snapshot que o
// lote guarda: depois de publicado, o lote não depende mais da API do museu.
export type Artwork = {
  externalId: string;
  title: string;
  imageUrl: string;
  artistDisplay: string | null;
  dateDisplay: string | null;
  mediumDisplay: string | null;
  isPublicDomain: boolean;
  attributes: Record<string, unknown>;
};

export type ArtworkSearch = {
  items: Artwork[];
  source: "cleveland" | "local";
  // true quando o museu não respondeu e a lista veio do acervo local de reserva.
  degraded: boolean;
  reason: "timeout" | "unavailable" | null;
  message: string | null;
};

export function searchArtworks(q: string) {
  return apiFetch<ArtworkSearch>(`/external/artworks?${new URLSearchParams({ q, limit: "8" }).toString()}`);
}

export type CreateLotInput = {
  externalId: string;
  title: string;
  imageUrl: string;
  attributes: Record<string, unknown>;
  startingBidCents: number;
  minIncrementCents: number;
  startsAt: string;
  endsAt: string;
};

export function createLot(input: CreateLotInput) {
  return apiFetch<{ lot: Lot }>("/lots", { method: "POST", body: JSON.stringify(input) });
}
