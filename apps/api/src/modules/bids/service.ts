import { prisma } from "../../db/client.js";
import { getDbNow, lockBidder, lockLot } from "../../db/locks.js";
import { AppError } from "../../lib/errors.js";
import { publishLotEvent } from "../../lib/events.js";
import { computeBidHash, genesisHash } from "../../lib/hash-chain.js";
import { closeIfDue } from "../settlement/service.js";
import { getBalance } from "../wallet/service.js";

export const ANTI_SNIPING_WINDOW_MS = 2 * 60 * 1000;

const formatCents = (cents: bigint) => (Number(cents) / 100).toFixed(2);

// Transação ÚNICA do lance. Tudo ou nada: se qualquer validação falhar, o
// rollback não deixa nenhum rastro (nem lance, nem prorrogação).
export async function placeBid(userId: string, lotId: string, amountCents: number) {
  const amount = BigInt(amountCents);

  const result = await prisma.$transaction(
    async (tx) => {
      // 1) Locks, SEMPRE nesta ordem (lote -> licitante); ver db/locks.ts.
      const lot = await lockLot(tx, lotId);
      if (!lot) throw new AppError("NOT_FOUND", "Lot not found");
      const bidder = await lockBidder(tx, userId);
      if (!bidder) throw new AppError("UNAUTHORIZED", "User no longer exists");

      // Relógio lido depois dos locks, no banco: o cliente nunca dita a hora.
      const now = await getDbNow(tx);

      // 2) Validações, da mais "estrutural" para a mais específica.
      if (bidder.role === "auctioneer") {
        throw new AppError("AUCTIONEER_CANNOT_BID", "Auctioneers cannot place bids");
      }
      if (lot.status !== "open" || lot.ends_at <= now) {
        throw new AppError("LOT_CLOSED", "This lot is closed and no longer accepts bids");
      }
      if (lot.starts_at > now) {
        throw new AppError("LOT_NOT_STARTED", "This lot has not started yet");
      }
      if (lot.leader_id === userId) {
        throw new AppError("ALREADY_LEADING", "You already have the highest bid on this lot");
      }

      const minimum =
        lot.current_bid_cents === null ? lot.starting_bid_cents : lot.current_bid_cents + lot.min_increment_cents;
      if (amount < minimum) {
        throw new AppError("BID_BELOW_MIN", `The minimum bid is ${formatCents(minimum)}`);
      }

      // Como o usuário não é o líder deste lote, o valor que ele já tem
      // comprometido vem só de OUTROS lotes: não há dupla contagem.
      const balance = await getBalance(tx, userId);
      if (amount > balance.availableCents) {
        throw new AppError(
          "INSUFFICIENT_FUNDS",
          `Insufficient funds: available balance is ${formatCents(balance.availableCents)}`,
        );
      }

      // 3) Lance entra na cadeia de hash. Com o lock do lote, o "último lance"
      // lido aqui é garantidamente o último de verdade.
      const seq = lot.bid_count + 1;
      const last = await tx.bid.findFirst({
        where: { lotId },
        orderBy: { seq: "desc" },
        select: { hash: true },
      });
      const prevHash =
        last?.hash ??
        genesisHash({
          lotId,
          auctioneerId: lot.auctioneer_id,
          startingBidCents: lot.starting_bid_cents,
          minIncrementCents: lot.min_increment_cents,
          startsAt: lot.starts_at,
        });
      const hash = computeBidHash({
        prevHash,
        lotId,
        seq,
        alias: bidder.public_alias,
        amountCents: amount,
        placedAt: now,
      });

      const bid = await tx.bid.create({
        data: { lotId, bidderId: userId, amountCents: amount, placedAt: now, seq, prevHash, hash },
      });

      // 4) Anti-sniping: lance nos últimos 2 min => ends_at = max(ends_at, agora + 2min).
      // Nunca encurta o lote; só empurra para frente.
      const extendedEndsAt = new Date(now.getTime() + ANTI_SNIPING_WINDOW_MS);
      const extended = extendedEndsAt > lot.ends_at;
      const endsAt = extended ? extendedEndsAt : lot.ends_at;

      const updatedLot = await tx.lot.update({
        where: { id: lotId },
        data: { currentBidCents: amount, leaderId: userId, bidCount: seq, endsAt },
        include: { leader: { select: { publicAlias: true } } },
      });

      const wallet = await getBalance(tx, userId);
      return { bid, lot: updatedLot, wallet, extended, now, alias: bidder.public_alias };
    },
    // Explícitos de propósito: o default do Prisma (5s) é curto demais para
    // uma fila de lances no mesmo lote esperando pelo FOR UPDATE.
    { timeout: 10_000, maxWait: 5_000 },
  );

  // Só depois do commit: nunca anunciar um lance que pode sofrer rollback.
  publishLotEvent({
    type: "bid_placed",
    lotId,
    bid: {
      seq: result.bid.seq,
      bidderAlias: result.alias,
      amountCents: Number(result.bid.amountCents),
      placedAt: result.bid.placedAt.toISOString(),
    },
    currentBidCents: Number(result.lot.currentBidCents),
    bidCount: result.lot.bidCount,
    leaderAlias: result.alias,
    endsAt: result.lot.endsAt.toISOString(),
    extended: result.extended,
    serverNow: new Date().toISOString(),
  });

  return result;
}

export async function listBids(lotId: string) {
  const lot = await prisma.lot.findUnique({ where: { id: lotId }, select: { id: true, status: true, endsAt: true } });
  if (!lot) throw new AppError("NOT_FOUND", "Lot not found");
  await closeIfDue(lot);

  return prisma.bid.findMany({
    where: { lotId },
    orderBy: { seq: "desc" },
    include: { bidder: { select: { publicAlias: true } } },
  });
}
