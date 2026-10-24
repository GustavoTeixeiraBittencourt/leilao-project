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

    app.log.error(error);
    return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Unexpected server error" });
  });
}
