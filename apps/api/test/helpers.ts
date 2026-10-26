import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db/client.js";
import { generatePublicAlias } from "../src/lib/public-alias.js";

// Os testes NÃO apagam o que criam: wallet_entries e bids são append-only
// (trigger bloqueia DELETE) e têm FK para users/lots. Tudo usa ids/e-mails
// únicos, então execuções repetidas não colidem; o seed da Etapa 3 reseta o banco.

export async function createUser(role: "auctioneer" | "bidder") {
  // O alias tem só 4 hex (65.536 valores) e é UNIQUE; com o banco de dev
  // acumulando usuários de teste, colisões acontecem. Tenta de novo.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.user.create({
        data: {
          email: `test-${randomUUID()}@example.com`,
          passwordHash: "not-a-real-hash",
          role,
          displayName: `Test ${role}`,
          publicAlias: generatePublicAlias(role),
        },
      });
    } catch (error) {
      const collision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!collision || attempt >= 10) throw error;
    }
  }
}

export function tokenFor(app: FastifyInstance, user: { id: string; role: "auctioneer" | "bidder" }) {
  return app.jwt.sign({ sub: user.id, role: user.role });
}

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

export async function fund(userId: string, amountCents: number) {
  await prisma.walletEntry.create({ data: { userId, kind: "deposit", amountCents: BigInt(amountCents) } });
}

type LotOptions = {
  auctioneerId: string;
  startsInMs?: number;
  endsInMs?: number;
  startingBidCents?: number;
  minIncrementCents?: number;
};

// Cria o lote direto no banco (sem passar pela API) para os testes poderem
// escolher horários arbitrários, inclusive já em andamento ou prestes a encerrar.
export async function createLotRow(options: LotOptions) {
  const now = Date.now();
  return prisma.lot.create({
    data: {
      auctioneerId: options.auctioneerId,
      externalId: randomUUID(),
      title: "Test lot",
      startingBidCents: BigInt(options.startingBidCents ?? 10_000),
      minIncrementCents: BigInt(options.minIncrementCents ?? 1_000),
      startsAt: new Date(now + (options.startsInMs ?? -60_000)),
      endsAt: new Date(now + (options.endsInMs ?? 3_600_000)),
    },
  });
}
