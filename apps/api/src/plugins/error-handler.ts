import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

export async function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ code: error.code, message: error.message });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      });
    }

    // Erro do próprio Fastify causado pelo cliente (JSON inválido, tipo de conteúdo, corpo grande
    // demais): é 4xx do cliente, não falha do servidor.
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.status(status).send({ code: "VALIDATION_ERROR", message: (error as Error).message });
    }

    app.log.error(error);
    return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Unexpected server error" });
  });
}
