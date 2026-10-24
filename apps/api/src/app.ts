import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { authRoutes } from "./modules/auth/routes.js";
import authPlugin from "./plugins/auth.js";
import { registerErrorHandler } from "./plugins/error-handler.js";

export async function buildApp() {
  const app = Fastify({
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

  return app;
}
