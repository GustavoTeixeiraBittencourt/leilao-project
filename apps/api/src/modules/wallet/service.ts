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

export async function getStatement(userId: string): Promise<WalletEntry[]> {
  return prisma.walletEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: STATEMENT_LIMIT,
  });
}
