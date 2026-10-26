import type { FastifyInstance } from "fastify";
import { lotParamsSchema } from "../lots/schemas.js";
import { auditLot } from "./service.js";

export async function auditRoutes(app: FastifyInstance) {
  // Público, sem login: qualquer pessoa confere o histórico de um lote e o
  // veredito íntegro/adulterado. Só lê o que está no banco (sem API externa).
  app.get("/audit/lots/:id", async (request) => {
    const { id } = lotParamsSchema.parse(request.params);
    return auditLot(id);
  });
}
