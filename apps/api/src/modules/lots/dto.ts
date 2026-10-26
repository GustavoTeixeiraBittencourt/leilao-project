import type { Lot, User } from "@prisma/client";

export type LotPhase = "scheduled" | "live" | "ended" | "cancelled";

// "Agendado" e "ao vivo" não existem no banco: são derivados do horário do
// SERVIDOR. `ended` cobre tanto status=closed quanto open com ends_at vencido
// (aguardando o worker liquidar) — para quem olha, em ambos o lote acabou.
export function lotPhase(lot: Pick<Lot, "status" | "startsAt" | "endsAt">, now: Date): LotPhase {
  if (lot.status === "cancelled") return "cancelled";
  if (lot.status === "closed" || lot.endsAt <= now) return "ended";
  if (lot.startsAt > now) return "scheduled";
  return "live";
}

// `winner` é opcional: só lotes lidos para exibição o carregam; o lote devolvido
// por um lance (ainda ao vivo) não tem vencedor.
type LotWithLeader = Lot & {
  leader: Pick<User, "publicAlias"> | null;
  winner?: Pick<User, "publicAlias"> | null;
};

// BigInt -> number só na borda da API (JSON.stringify não serializa bigint);
// centavos desta simulação ficam muito abaixo de Number.MAX_SAFE_INTEGER.
// O líder é exposto só pelo alias pseudônimo, nunca nome/e-mail.
export function lotDto(lot: LotWithLeader, now: Date) {
  return {
    id: lot.id,
    title: lot.title,
    imageUrl: lot.imageUrl,
    attributes: lot.attributes,
    startingBidCents: Number(lot.startingBidCents),
    minIncrementCents: Number(lot.minIncrementCents),
    startsAt: lot.startsAt.toISOString(),
    endsAt: lot.endsAt.toISOString(),
    status: lot.status,
    phase: lotPhase(lot, now),
    currentBidCents: lot.currentBidCents === null ? null : Number(lot.currentBidCents),
    bidCount: lot.bidCount,
    leaderAlias: lot.leader?.publicAlias ?? null,
    // Resultado (só em lotes encerrados): quem arrematou e por quanto.
    winnerAlias: lot.winner?.publicAlias ?? null,
    finalPriceCents: lot.finalPriceCents === null ? null : Number(lot.finalPriceCents),
    serverNow: now.toISOString(),
  };
}
