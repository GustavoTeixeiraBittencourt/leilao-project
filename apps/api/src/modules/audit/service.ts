import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { readLotChain } from "../../db/locks.js";
import { AppError } from "../../lib/errors.js";
import { lotPhase } from "../lots/dto.js";
import { closeIfDue } from "../settlement/service.js";
import { verifyLot } from "./verify.js";

export async function auditLot(lotId: string) {
  const head = await prisma.lot.findUnique({ where: { id: lotId }, select: { id: true, status: true, endsAt: true } });
  if (!head) throw new AppError("NOT_FOUND", "Lot not found");
  // Se venceu e o worker ainda não passou, fecha agora: o veredito de um lote
  // encerrado precisa conferir o selo, que só existe depois de fechar.
  await closeIfDue(head);

  // REPEATABLE READ: lote, comprovante e cadeia no MESMO snapshot. Sem isso, um
  // lance chegando entre as leituras viraria um falso "adulterado".
  const { lot, receipt, chain } = await prisma.$transaction(
    async (tx) => {
      const lot = await tx.lot.findUniqueOrThrow({
        where: { id: lotId },
        include: { winner: { select: { publicAlias: true } } },
      });
      const receipt = await tx.receipt.findUnique({ where: { lotId } });
      const chain = await readLotChain(tx, lotId);
      return { lot, receipt, chain };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000, maxWait: 5_000 },
  );

  const result = verifyLot(lot, chain, receipt);
  const now = new Date();

  // Só dados públicos: alias pseudônimo, nunca nome ou e-mail.
  return {
    verdict: result.verdict,
    firstBreak: result.firstBreak,
    sealed: result.sealed,
    checkedBids: result.checkedBids,
    lot: {
      id: lot.id,
      title: lot.title,
      imageUrl: lot.imageUrl,
      status: lot.status,
      phase: lotPhase(lot, now),
      startsAt: lot.startsAt.toISOString(),
      endsAt: lot.endsAt.toISOString(),
      startingBidCents: Number(lot.startingBidCents),
      minIncrementCents: Number(lot.minIncrementCents),
      bidCount: lot.bidCount,
      currentBidCents: lot.currentBidCents === null ? null : Number(lot.currentBidCents),
      finalPriceCents: lot.finalPriceCents === null ? null : Number(lot.finalPriceCents),
      winnerAlias: lot.winner?.publicAlias ?? null,
    },
    seal: lot.status === "closed" ? { count: lot.sealCount, hash: lot.sealHash } : null,
    bids: chain.map((row) => ({
      seq: row.seq,
      bidderAlias: row.alias,
      amountCents: Number(row.amount_cents),
      placedAt: row.placed_at.toISOString(),
      prevHash: row.prev_hash,
      hash: row.hash,
    })),
    serverNow: now.toISOString(),
  };
}
