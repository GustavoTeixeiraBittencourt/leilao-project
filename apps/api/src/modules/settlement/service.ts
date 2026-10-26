import { randomBytes } from "node:crypto";
import { prisma, type DbClient } from "../../db/client.js";
import { getDbNow, lockBidder, lockLot, pickDueLot, type LockedLot } from "../../db/locks.js";
import { publishLotEvent } from "../../lib/events.js";
import { genesisHash } from "../../lib/hash-chain.js";

export type SettlementResult = {
  lotId: string;
  winnerAlias: string | null;
  finalPriceCents: bigint | null;
  closedAt: Date;
};

// Explícitos como na transação de lance: o default do Prisma (5s) é curto
// demais se a liquidação esperar o FOR UPDATE atrás de uma fila de lances.
const TX_OPTIONS = { timeout: 10_000, maxWait: 5_000 } as const;

// Liquida UM lote que já está travado (lockLot / pickDueLot). Roda dentro da
// transação de quem chamou, que segurou o lock do lote primeiro.
//
// Idempotência em três camadas: (1) sob o lock, só liquida se ainda está
// `open` e vencido, então a segunda chamada vira no-op; (2) os lançamentos do
// ledger entram com ON CONFLICT DO NOTHING no índice único parcial
// (lot_id, kind, user_id); (3) o comprovante tem UNIQUE(lot_id).
async function settleLocked(tx: DbClient, lot: LockedLot): Promise<SettlementResult | null> {
  const now = await getDbNow(tx);
  if (lot.status !== "open" || lot.ends_at > now) return null;

  // Lock do vencedor depois do lote (ordem lote -> licitante), igual ao lance.
  // Protege contra um lance do vencedor em OUTRO lote ler o ledger antes do
  // débito e os lotes depois do fechamento (disponível maior que o real).
  // Honestidade: hoje o FK do débito em wallet_entries já tomaria um KEY SHARE
  // nesta linha e serializaria do mesmo jeito (testei removendo este lock e o
  // teste de espera continuou passando). Mantido explícito porque depender de
  // efeito colateral de FK é frágil e a regra de ordem fica visível no código.
  const winner = lot.leader_id ? await lockBidder(tx, lot.leader_id) : null;

  // Selo: contagem e hash do último lance. Sem lances, o genesis — assim um
  // lance inserido depois num lote vazio também quebra a conferência.
  const last =
    lot.bid_count > 0
      ? await tx.bid.findFirst({ where: { lotId: lot.id }, orderBy: { seq: "desc" }, select: { seq: true, hash: true } })
      : null;
  if (lot.bid_count > 0 && last?.seq !== lot.bid_count) {
    // Invariante quebrada (lote diz N lances, cadeia termina em outro seq):
    // não liquidar em cima de dados inconsistentes; o rollback preserva o estado.
    throw new Error(`Lot ${lot.id} bid_count=${lot.bid_count} disagrees with the bid chain`);
  }
  const sealHash =
    last?.hash ??
    genesisHash({
      lotId: lot.id,
      auctioneerId: lot.auctioneer_id,
      startingBidCents: lot.starting_bid_cents,
      minIncrementCents: lot.min_increment_cents,
      startsAt: lot.starts_at,
    });

  await tx.lot.update({
    where: { id: lot.id },
    data: {
      status: "closed",
      winnerId: winner?.id ?? null,
      finalPriceCents: winner ? lot.current_bid_cents : null,
      closedAt: now,
      sealCount: lot.bid_count,
      sealHash,
    },
  });

  if (winner && lot.current_bid_cents !== null) {
    const price = lot.current_bid_cents;
    await tx.walletEntry.createMany({
      data: [
        { userId: winner.id, kind: "settlement_debit", amountCents: -price, lotId: lot.id },
        { userId: lot.auctioneer_id, kind: "settlement_credit", amountCents: price, lotId: lot.id },
      ],
      skipDuplicates: true,
    });
    await tx.receipt.createMany({
      data: [
        {
          lotId: lot.id,
          winnerId: winner.id,
          amountCents: price,
          publicToken: randomBytes(16).toString("base64url"),
          sealCount: lot.bid_count,
          sealHash,
        },
      ],
      skipDuplicates: true,
    });
  }

  return {
    lotId: lot.id,
    winnerAlias: winner?.public_alias ?? null,
    finalPriceCents: winner ? lot.current_bid_cents : null,
    closedAt: now,
  };
}

// Só depois do commit: nunca anunciar um fechamento que pode sofrer rollback.
function announce(result: SettlementResult): void {
  publishLotEvent({
    type: "lot_closed",
    lotId: result.lotId,
    winnerAlias: result.winnerAlias,
    finalPriceCents: result.finalPriceCents === null ? null : Number(result.finalPriceCents),
    closedAt: result.closedAt.toISOString(),
    serverNow: new Date().toISOString(),
  });
}

// Liquida um lote específico se (e só se) ele já venceu. Usado pelo
// fechamento preguiçoso nas leituras. Devolve null se nada foi feito.
export async function settleLot(lotId: string): Promise<SettlementResult | null> {
  const result = await prisma.$transaction(async (tx) => {
    const lot = await lockLot(tx, lotId);
    return lot ? settleLocked(tx, lot) : null;
  }, TX_OPTIONS);
  if (result) announce(result);
  return result;
}

// Pega o próximo lote vencido que ninguém está segurando e o liquida.
export async function settleNextDueLot(): Promise<SettlementResult | null> {
  const result = await prisma.$transaction(async (tx) => {
    const lot = await pickDueLot(tx);
    return lot ? settleLocked(tx, lot) : null;
  }, TX_OPTIONS);
  if (result) announce(result);
  return result;
}

// Um tick do worker: esvazia a fila de vencidos (com teto, para um backlog
// grande não monopolizar o processo). Cada lote em transação própria: um lote
// com problema não impede os demais.
export async function closeDueLots(limit = 50): Promise<number> {
  let closed = 0;
  while (closed < limit) {
    const result = await settleNextDueLot();
    if (!result) break;
    closed += 1;
  }
  return closed;
}

// Fechamento preguiçoso: chamado nas leituras de um lote. Se o worker estiver
// parado (plano que dorme, por exemplo), a primeira leitura depois do fim
// fecha o lote. Retorna true se este lote precisava fechar.
export async function closeIfDue(lot: { id: string; status: string; endsAt: Date }): Promise<boolean> {
  if (lot.status !== "open" || lot.endsAt > new Date()) return false;
  await settleLot(lot.id);
  return true;
}
