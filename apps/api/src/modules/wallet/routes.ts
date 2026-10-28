import type { FastifyInstance } from "fastify";
import { depositSchema } from "./schemas.js";
import { deposit, getBalance, getBidActivity, getStatement, type WalletBalance } from "./service.js";
import { prisma } from "../../db/client.js";

// BigInt -> number só aqui, na borda da API (JSON.stringify não serializa
// bigint). Valores em centavos desta simulação ficam muito abaixo de
// Number.MAX_SAFE_INTEGER, então a conversão é segura e deliberada.
function balanceDto(balance: WalletBalance) {
  return {
    totalCents: Number(balance.totalCents),
    committedCents: Number(balance.committedCents),
    availableCents: Number(balance.availableCents),
  };
}

export async function walletRoutes(app: FastifyInstance) {
  // Leiloeiro também tem carteira (recebe o crédito da liquidação), então a
  // leitura vale para qualquer papel; só o depósito é exclusivo do licitante.
  app.get("/wallet", { preHandler: app.authenticate }, async (request) => {
    const userId = request.user.sub;
    const [balance, entries, bids] = await Promise.all([
      getBalance(prisma, userId),
      getStatement(userId),
      getBidActivity(userId),
    ]);
    return {
      ...balanceDto(balance),
      entries: entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        amountCents: Number(entry.amountCents),
        lotId: entry.lotId,
        createdAt: entry.createdAt.toISOString(),
      })),
      // Lances do próprio usuário, para o extrato. Informativo: não entra no total (ver service).
      bids: bids.map((bid) => ({
        id: bid.id,
        lotId: bid.lotId,
        lotTitle: bid.lotTitle,
        amountCents: Number(bid.amountCents),
        placedAt: bid.placedAt.toISOString(),
        status: bid.status,
      })),
      serverNow: new Date().toISOString(),
    };
  });

  app.post(
    "/wallet/deposit",
    { preHandler: [app.authenticate, app.requireRole("bidder")] },
    async (request, reply) => {
      const input = depositSchema.parse(request.body);
      const balance = await deposit(request.user.sub, input.amountCents);
      return reply.status(201).send({ ...balanceDto(balance), serverNow: new Date().toISOString() });
    },
  );
}
