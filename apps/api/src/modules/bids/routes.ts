import type { FastifyInstance } from "fastify";
import { lotDto } from "../lots/dto.js";
import { lotParamsSchema } from "../lots/schemas.js";
import { placeBidSchema } from "./schemas.js";
import { listBids, placeBid } from "./service.js";

export async function bidRoutes(app: FastifyInstance) {
  // Só `authenticate` (e não requireRole("bidder")) de propósito: o leiloeiro
  // precisa chegar à regra de negócio para receber AUCTIONEER_CANNOT_BID, o
  // código estável que o front sabe explicar, em vez de um FORBIDDEN genérico.
  app.post("/lots/:id/bids", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = lotParamsSchema.parse(request.params);
    const { amountCents } = placeBidSchema.parse(request.body);
    const result = await placeBid(request.user.sub, id, amountCents);

    return reply.status(201).send({
      bid: {
        seq: result.bid.seq,
        amountCents: Number(result.bid.amountCents),
        placedAt: result.bid.placedAt.toISOString(),
      },
      lot: lotDto(result.lot, result.now),
      wallet: {
        totalCents: Number(result.wallet.totalCents),
        committedCents: Number(result.wallet.committedCents),
        availableCents: Number(result.wallet.availableCents),
      },
      extended: result.extended,
    });
  });

  // Histórico público: só alias pseudônimo, nunca nome/e-mail.
  app.get("/lots/:id/bids", async (request) => {
    const { id } = lotParamsSchema.parse(request.params);
    const bids = await listBids(id);
    return {
      bids: bids.map((bid) => ({
        seq: bid.seq,
        bidderAlias: bid.bidder.publicAlias,
        amountCents: Number(bid.amountCents),
        placedAt: bid.placedAt.toISOString(),
      })),
      serverNow: new Date().toISOString(),
    };
  });
}
