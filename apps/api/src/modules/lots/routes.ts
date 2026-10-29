import type { FastifyInstance } from "fastify";
import { lotDto } from "./dto.js";
import { createLotSchema, listLotsQuerySchema, lotParamsSchema, updateLotSchema } from "./schemas.js";
import { cancelLot, createLot, getLot, listLots, updateLot } from "./service.js";

export async function lotRoutes(app: FastifyInstance) {
  app.post(
    "/lots",
    { preHandler: [app.authenticate, app.requireRole("auctioneer")] },
    async (request, reply) => {
      const input = createLotSchema.parse(request.body);
      const lot = await createLot(request.user.sub, input);
      return reply.status(201).send({ lot: lotDto(lot, new Date()) });
    },
  );

  app.patch(
    "/lots/:id",
    { preHandler: [app.authenticate, app.requireRole("auctioneer")] },
    async (request) => {
      const { id } = lotParamsSchema.parse(request.params);
      const input = updateLotSchema.parse(request.body);
      const lot = await updateLot(request.user.sub, id, input);
      return { lot: lotDto(lot, new Date()) };
    },
  );

  app.post(
    "/lots/:id/cancel",
    { preHandler: [app.authenticate, app.requireRole("auctioneer")] },
    async (request) => {
      const { id } = lotParamsSchema.parse(request.params);
      const lot = await cancelLot(request.user.sub, id);
      return { lot: lotDto(lot, new Date()) };
    },
  );

  // Vitrine: pública. Sem `phase` devolve só as contagens por fase (as abas do
  // mobile mostram "Ao vivo · 6"); com `phase`, os lotes daquela fase.
  app.get("/lots", async (request) => {
    const query = listLotsQuerySchema.parse(request.query);
    const now = new Date();
    const { lots, counts } = await listLots(query, now);
    return { lots: lots.map((lot) => lotDto(lot, now)), counts, serverNow: now.toISOString() };
  });

  // Público (vitrine, sala e auditoria funcionam sem login). Lê só o snapshot
  // guardado no banco: a API externa nunca é consultada aqui.
  app.get("/lots/:id", async (request) => {
    const { id } = lotParamsSchema.parse(request.params);
    const lot = await getLot(id);
    return { lot: lotDto(lot, new Date()) };
  });
}
