import type { WalletEntry } from "@prisma/client";
import { prisma, type DbClient } from "../../db/client.js";

export type WalletBalance = {
  totalCents: bigint;
  committedCents: bigint;
  availableCents: bigint;
};

// Total = soma do ledger (append-only). Comprometido é DERIVADO: soma do lance
// atual dos lotes abertos em que o usuário lidera. Não existe coluna de saldo
// para ficar dessincronizada: se o usuário é superado, o lote muda de líder
// na mesma transação do lance e o valor volta ao disponível sem nenhum estorno.
export async function getBalance(client: DbClient, userId: string): Promise<WalletBalance> {
  const [ledger, leading] = await Promise.all([
    client.walletEntry.aggregate({ where: { userId }, _sum: { amountCents: true } }),
    client.lot.aggregate({
      where: { status: "open", leaderId: userId },
      _sum: { currentBidCents: true },
    }),
  ]);

  const totalCents = BigInt(ledger._sum.amountCents ?? 0);
  const committedCents = BigInt(leading._sum.currentBidCents ?? 0);
  return { totalCents, committedCents, availableCents: totalCents - committedCents };
}

export async function deposit(userId: string, amountCents: number): Promise<WalletBalance> {
  await prisma.walletEntry.create({
    data: { userId, kind: "deposit", amountCents: BigInt(amountCents) },
  });
  return getBalance(prisma, userId);
}

const STATEMENT_LIMIT = 50;

// Situação de um lance do próprio usuário. Não é um lançamento do ledger: lance só RESERVA
// valor (o comprometido é derivado), então o saldo total não muda. É só informação para o
// extrato mostrar o que a pessoa fez.
export type BidActivityStatus = "leading" | "outbid" | "won";

export type BidActivity = {
  id: string;
  lotId: string;
  lotTitle: string;
  amountCents: bigint;
  placedAt: Date;
  status: BidActivityStatus;
};

// O lance é o último do lote (seq == bid_count) se e só se ele é o líder atual, porque quem
// dá o último lance vira líder. Esse lance está "leading" enquanto o lote está aberto e vira
// "won" quando o lote fecha. Qualquer lance anterior foi superado.
export function bidActivityStatus(bid: { seq: number }, lot: { status: string; bidCount: number }): BidActivityStatus {
  if (bid.seq !== lot.bidCount) return "outbid";
  return lot.status === "closed" ? "won" : "leading";
}

export async function getBidActivity(userId: string): Promise<BidActivity[]> {
  const bids = await prisma.bid.findMany({
    where: { bidderId: userId },
    orderBy: { placedAt: "desc" },
    take: STATEMENT_LIMIT,
    select: {
      id: true,
      seq: true,
      lotId: true,
      amountCents: true,
      placedAt: true,
      lot: { select: { title: true, status: true, bidCount: true } },
    },
  });
  return bids.map((bid) => ({
    id: bid.id,
    lotId: bid.lotId,
    lotTitle: bid.lot.title,
    amountCents: bid.amountCents,
    placedAt: bid.placedAt,
    status: bidActivityStatus(bid, bid.lot),
  }));
}

export async function getStatement(userId: string): Promise<WalletEntry[]> {
  return prisma.walletEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: STATEMENT_LIMIT,
  });
}
