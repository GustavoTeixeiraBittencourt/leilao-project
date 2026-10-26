import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { lotDto } from "../lots/dto.js";

export async function meRoutes(app: FastifyInstance) {
  // "Meus arremates": lotes que o licitante venceu, com o token do comprovante
  // (o front monta o link compartilhável a partir dele).
  app.get("/me/wins", { preHandler: [app.authenticate, app.requireRole("bidder")] }, async (request) => {
    const receipts = await prisma.receipt.findMany({
      where: { winnerId: request.user.sub },
      orderBy: { issuedAt: "desc" },
      include: { lot: { select: { id: true, title: true, imageUrl: true } } },
    });
    return {
      wins: receipts.map((receipt) => ({
        receiptToken: receipt.publicToken,
        lotId: receipt.lot.id,
        title: receipt.lot.title,
        imageUrl: receipt.lot.imageUrl,
        amountCents: Number(receipt.amountCents),
        issuedAt: receipt.issuedAt.toISOString(),
      })),
      serverNow: new Date().toISOString(),
    };
  });

  // Resultado dos lotes encerrados do leiloeiro: arrematado ou não, por quanto,
  // e o total efetivamente recebido (soma dos créditos de liquidação no ledger).
  app.get("/me/auctions", { preHandler: [app.authenticate, app.requireRole("auctioneer")] }, async (request) => {
    const userId = request.user.sub;
    const [lots, received] = await Promise.all([
      prisma.lot.findMany({
        where: { auctioneerId: userId },
        orderBy: [{ startsAt: "desc" }, { id: "desc" }],
        include: { leader: { select: { publicAlias: true } }, winner: { select: { publicAlias: true } } },
      }),
      prisma.walletEntry.aggregate({
        where: { userId, kind: "settlement_credit" },
        _sum: { amountCents: true },
      }),
    ]);

    const now = new Date();
    return {
      // Todos os lotes do leiloeiro (qualquer fase, inclusive cancelados): é a
      // tabela "Meus lotes". `canCancel` espelha a regra do servidor (aberto, ainda
      // não terminou e sem lances) para a UI não duplicar a regra; quem decide de
      // verdade é o POST /lots/:id/cancel.
      lots: lots.map((lot) => ({
        ...lotDto(lot, now),
        sold: lot.status === "closed" && lot.winnerId !== null,
        closedAt: lot.closedAt?.toISOString() ?? null,
        canCancel: lot.status === "open" && lot.endsAt > now && lot.bidCount === 0,
      })),
      totalReceivedCents: Number(received._sum.amountCents ?? 0),
      serverNow: now.toISOString(),
    };
  });
}
