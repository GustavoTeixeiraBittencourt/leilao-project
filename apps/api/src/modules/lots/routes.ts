import type { FastifyInstance } from "fastify";
import { lotDto } from "./dto.js";
import { createLotSchema, lotParamsSchema } from "./schemas.js";
import { createLot, getLot } from "./service.js";

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

  // Público (vitrine, sala e auditoria funcionam sem login). Lê só o snapshot
  // guardado no banco: a API externa nunca é consultada aqui.
  app.get("/lots/:id", async (request) => {
    const { id } = lotParamsSchema.parse(request.params);
    const lot = await getLot(id);
    return { lot: lotDto(lot, new Date()) };
  });
}
