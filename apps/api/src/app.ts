import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./config/env.js";
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

  await app.register(cors, { origin: env.CORS_ORIGIN });
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
