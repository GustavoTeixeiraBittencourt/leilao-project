import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/db/client.js";
import { generatePublicAlias } from "../src/lib/public-alias.js";

// Os testes NÃO apagam o que criam: wallet_entries e bids são append-only
// (trigger bloqueia DELETE) e têm FK para users/lots. Tudo usa ids/e-mails
// únicos, então execuções repetidas não colidem; o seed da Etapa 3 reseta o banco.

export async function createUser(role: "auctioneer" | "bidder") {
  return prisma.user.create({
    data: {
      email: `test-${randomUUID()}@example.com`,
      passwordHash: "not-a-real-hash",
      role,
      displayName: `Test ${role}`,
      publicAlias: generatePublicAlias(role),
    },
  });
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
