import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { startCloser } from "./worker/closer.js";

const app = await buildApp();

try {
  await app.listen({ host: "0.0.0.0", port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// O worker sobe aqui e não em buildApp(): os testes constroem o app sem ele
// e controlam quando a liquidação roda.
const closer = startCloser({ intervalMs: env.WORKER_INTERVAL_MS, logger: app.log });

async function shutdown() {
  await closer.stop();
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
