import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { openApiSpec } from "./docs/openapi.js";
import { auditRoutes } from "./modules/audit/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { bidRoutes } from "./modules/bids/routes.js";
import { eventRoutes } from "./modules/events/routes.js";
import { externalRoutes } from "./modules/external/routes.js";
import { lotRoutes } from "./modules/lots/routes.js";
import { meRoutes } from "./modules/me/routes.js";
import { receiptRoutes } from "./modules/receipts/routes.js";
import { walletRoutes } from "./modules/wallet/routes.js";
import authPlugin from "./plugins/auth.js";
import { registerErrorHandler } from "./plugins/error-handler.js";

export type BuildAppOptions = {
  // Só os testes mexem nisto, para provar o heartbeat sem esperar 20s.
  sseHeartbeatMs?: number;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    // Conexões SSE nunca terminam sozinhas: sem isto, app.close() (SIGTERM no
    // deploy/restart) esperaria por elas indefinidamente.
    forceCloseConnections: true,
    logger:
      env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty" } }
        : true,
  });

  await app.register(cors, { origin: env.CORS_ORIGIN, methods: ["GET", "HEAD", "POST", "PATCH", "OPTIONS"] });
  // Documentação interativa em /docs (OpenAPI escrita à mão em docs/openapi.ts; JSON em /docs/json).
  await app.register(swagger, {
    mode: "static",
    specification: { document: openApiSpec as never },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  // Corpo vazio com Content-Type JSON (ex.: POST /lots/:id/cancel, que não tem corpo) é aceito como
  // "sem corpo". Sem isto o Fastify recusa com FST_ERR_CTP_EMPTY_JSON_BODY. JSON malformado continua 400.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    if (body === "") return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const error = new Error("Body is not valid JSON") as Error & { statusCode: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });
  await registerErrorHandler(app);
  await app.register(authPlugin);

  app.get("/health", async () => ({ status: "ok", serverNow: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(walletRoutes);
  await app.register(lotRoutes);
  await app.register(bidRoutes);
  await app.register(auditRoutes);
  await app.register(receiptRoutes);
  await app.register(meRoutes);
  await app.register(externalRoutes);
  await app.register(eventRoutes, { heartbeatMs: options.sseHeartbeatMs });

  return app;
}
