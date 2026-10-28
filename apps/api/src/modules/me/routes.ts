import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { lotDto, lotPhase } from "../lots/dto.js";
import { bidderLotStatus } from "./bid-status.js";

// Teto de lotes na tela "Meus arremates" (os de lance mais recente primeiro).
const MY_BIDS_LIMIT = 100;

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

  // "Meus arremates", visão completa: todos os lotes em que o licitante deu lance, um item
  // por lote, com a situação (liderando, superado, arrematado, não arrematado). Os vencidos
  // trazem o token do comprovante. Leitura pura: não toca no ledger nem no saldo.
  app.get("/me/bids", { preHandler: [app.authenticate, app.requireRole("bidder")] }, async (request) => {
    const userId = request.user.sub;

    // O banco agrupa por lote: maior lance, quantidade e horário do último lance, já na
    // ordem certa (o lote com lance mais recente primeiro).
    const groups = await prisma.bid.groupBy({
      by: ["lotId"],
      where: { bidderId: userId },
      _max: { amountCents: true, placedAt: true },
      _count: { _all: true },
      orderBy: { _max: { placedAt: "desc" } },
      take: MY_BIDS_LIMIT,
    });

    const lots = await prisma.lot.findMany({
      where: { id: { in: groups.map((group) => group.lotId) } },
      include: { receipt: { select: { publicToken: true, issuedAt: true } } },
    });
    const lotById = new Map(lots.map((lot) => [lot.id, lot]));

    const now = new Date();
    return {
      bids: groups.flatMap((group) => {
        const lot = lotById.get(group.lotId);
        if (!lot) return [];
        const status = bidderLotStatus(lot, userId);
        const finalPrice = lot.finalPriceCents ?? lot.currentBidCents;
        return [
          {
            lotId: lot.id,
            title: lot.title,
            imageUrl: lot.imageUrl,
            phase: lotPhase(lot, now),
            endsAt: lot.endsAt.toISOString(),
            status,
            myHighestBidCents: Number(group._max.amountCents),
            myBidCount: group._count._all,
            // Lote aberto: lance atual. Lote fechado: valor final.
            currentBidCents: finalPrice === null ? null : Number(finalPrice),
            // O comprovante só existe (e só é do usuário) quando ele arrematou.
            receiptToken: status === "won" ? (lot.receipt?.publicToken ?? null) : null,
            issuedAt: status === "won" ? (lot.receipt?.issuedAt.toISOString() ?? null) : null,
            lastBidAt: (group._max.placedAt as Date).toISOString(),
          },
        ];
      }),
      serverNow: now.toISOString(),
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
