import type { Bid, BidPlacedEvent, LotCancelledEvent, LotClosedEvent } from "../api/bids";
import type { Lot } from "../api/lots";

// Regras puras da Sala do lote. Ficam fora dos componentes para serem testadas sem
// React: é aqui que o estado do SSE vira estado de tela, e um erro aqui mostraria
// um lance errado ou duplicaria uma linha do histórico.

// Menor lance aceito agora: o inicial no 1º lance; depois, lance atual + incremento.
// Espelha a regra do servidor, que continua sendo quem decide (BID_BELOW_MIN).
export function minNextBidCents(lot: Pick<Lot, "bidCount" | "currentBidCents" | "startingBidCents" | "minIncrementCents">): number {
  if (lot.bidCount === 0 || lot.currentBidCents === null) return lot.startingBidCents;
  return lot.currentBidCents + lot.minIncrementCents;
}

// Aplica um lance novo ao lote. Ignora evento velho ou repetido: o mesmo lance chega
// pela resposta do POST e pelo SSE, em qualquer ordem, e só o de maior `bidCount` vale.
export function applyBidPlaced(lot: Lot, event: BidPlacedEvent): Lot {
  if (event.bidCount <= lot.bidCount) return lot;
  return {
    ...lot,
    currentBidCents: event.currentBidCents,
    bidCount: event.bidCount,
    leaderAlias: event.leaderAlias,
    endsAt: event.endsAt,
  };
}

export function applyLotClosed(lot: Lot, event: LotClosedEvent): Lot {
  return {
    ...lot,
    status: "closed",
    phase: "ended",
    winnerAlias: event.winnerAlias,
    finalPriceCents: event.finalPriceCents,
  };
}

export function applyLotCancelled(lot: Lot, _event: LotCancelledEvent): Lot {
  return { ...lot, status: "cancelled", phase: "cancelled" };
}

// A API entrega o histórico do mais novo para o mais antigo; a tela e o `mergeBid`
// trabalham em ordem crescente de `seq` (a tela inverte só para exibir). Normaliza
// uma vez, na entrada, para o cache nunca guardar as duas ordens.
export function bidsAscending(bids: Bid[]): Bid[] {
  return [...bids].sort((a, b) => a.seq - b.seq);
}

// Insere o lance na ordem de `seq`, sem duplicar.
export function mergeBid(bids: Bid[], bid: Bid): Bid[] {
  if (bids.some((existing) => existing.seq === bid.seq)) return bids;
  return [...bids, bid].sort((a, b) => a.seq - b.seq);
}

export type Standing = "leading" | "outbid" | "none";

// "Você está ganhando" / "Você foi superado". O SSE é público e só traz alias, então
// a comparação é feita aqui com o alias do usuário logado.
export function standingOf(lot: Pick<Lot, "leaderAlias">, bids: Bid[], alias: string | null): Standing {
  if (!alias) return "none";
  if (lot.leaderAlias === alias) return "leading";
  return bids.some((bid) => bid.bidderAlias === alias) ? "outbid" : "none";
}

// O cliente nunca decide que a fase mudou (o relógio dele pode estar errado), mas
// precisa saber QUANDO perguntar de novo ao servidor: o lote agendado que já passou
// do início ou o ao vivo que já passou do fim. Devolve true nesses dois casos.
export function needsPhaseRefresh(lot: Pick<Lot, "phase" | "startsAt" | "endsAt">, serverNowMs: number): boolean {
  if (lot.phase === "scheduled") return serverNowMs >= Date.parse(lot.startsAt);
  if (lot.phase === "live") return serverNowMs >= Date.parse(lot.endsAt);
  return false;
}

// Texto para o leitor de tela anunciar o tempo restante. A contagem visual muda a
// cada segundo, mas anunciar isso seria insuportável (regra do Figma: aria-live em
// intervalos). O texto só muda quando passa de faixa, então só aí é lido de novo.
export function remainingAnnouncement(ms: number): string {
  if (ms <= 0) return "Lote encerrando.";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Falta menos de 1 minuto para o encerramento.";
  if (minutes < 10) return `Faltam ${minutes} ${minutes === 1 ? "minuto" : "minutos"} para o encerramento.`;
  if (minutes < 60) return `Faltam ${Math.floor(minutes / 10) * 10} minutos para o encerramento.`;
  const hours = Math.floor(minutes / 60);
  return `Faltam ${hours} ${hours === 1 ? "hora" : "horas"} para o encerramento.`;
}
