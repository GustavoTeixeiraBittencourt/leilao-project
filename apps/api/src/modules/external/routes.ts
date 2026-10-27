import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { searchArtworks } from "./cleveland.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

const DEGRADED_MESSAGES = {
  timeout: "The museum catalog took too long to respond. Showing a few local works instead.",
  unavailable: "The museum catalog is unavailable right now. Showing a few local works instead.",
} as const;

export async function externalRoutes(app: FastifyInstance) {
  // Só o leiloeiro busca (painel "Novo lote"); exigir login também impede que
  // a rota vire um proxy aberto para a API do museu. Nunca devolve 5xx por falha
  // externa: degrada com `degraded: true`, o motivo e o fallback local.
  app.get(
    "/external/artworks",
    { preHandler: [app.authenticate, app.requireRole("auctioneer")] },
    async (request) => {
      const { q, limit } = searchQuerySchema.parse(request.query);
      const result = await searchArtworks(q, limit);
      return {
        ...result,
        message: result.reason ? DEGRADED_MESSAGES[result.reason] : null,
        serverNow: new Date().toISOString(),
      };
    },
  );
}
