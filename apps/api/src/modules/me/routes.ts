import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";

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
        where: { auctioneerId: userId, status: "closed" },
        orderBy: { closedAt: "desc" },
        include: { winner: { select: { publicAlias: true } } },
      }),
      prisma.walletEntry.aggregate({
        where: { userId, kind: "settlement_credit" },
        _sum: { amountCents: true },
      }),
    ]);

    return {
      results: lots.map((lot) => ({
        lotId: lot.id,
        title: lot.title,
        closedAt: lot.closedAt?.toISOString() ?? null,
        bidCount: lot.bidCount,
        sold: lot.winnerId !== null,
        winnerAlias: lot.winner?.publicAlias ?? null,
        finalPriceCents: lot.finalPriceCents === null ? null : Number(lot.finalPriceCents),
      })),
      totalReceivedCents: Number(received._sum.amountCents ?? 0),
      serverNow: new Date().toISOString(),
    };
  });
}
