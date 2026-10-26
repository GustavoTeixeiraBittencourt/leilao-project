import type { OutgoingHttpHeaders } from "node:http";
import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/client.js";
import { AppError } from "../../lib/errors.js";
import { subscribeLotEvents } from "../../lib/events.js";
import { lotParamsSchema } from "../lots/schemas.js";

export type EventRoutesOptions = {
  // Intervalo do "ping". Proxies (Render incluso) derrubam conexão ociosa; o
  // ping mantém o stream vivo e ainda entrega serverNow para o cliente
  // recalibrar o relógio da contagem regressiva.
  heartbeatMs?: number;
};

export const DEFAULT_HEARTBEAT_MS = 20_000;

export async function eventRoutes(app: FastifyInstance, options: EventRoutesOptions) {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  // Público de propósito: o EventSource do navegador não consegue enviar o
  // cabeçalho Authorization, e os eventos só carregam dados já públicos (alias,
  // valores, horários). "Você está ganhando" é decidido no cliente comparando alias.
  app.get("/lots/:id/events", async (request, reply) => {
    const { id } = lotParamsSchema.parse(request.params);
    const lot = await prisma.lot.findUnique({ where: { id }, select: { id: true } });
    if (!lot) throw new AppError("NOT_FOUND", "Lot not found");

    // hijack: a partir daqui a resposta é escrita à mão e os hooks do Fastify
    // (inclusive o que acrescentaria CORS no onSend) não rodam mais. Os cabeçalhos
    // de CORS que o plugin já colocou em `reply` precisam ser repassados aqui,
    // senão o navegador bloqueia o EventSource vindo de outra origem.
    reply.hijack();
    const raw = reply.raw;
    const inherited: OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) inherited[name] = value;
    }
    raw.writeHead(200, {
      ...inherited,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // evita buffer em proxies nginx-like
    });

    const send = (event: string, data: unknown) => {
      if (raw.destroyed || raw.writableEnded) return;
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Reconexão do EventSource em 3s. Eventos perdidos durante a queda NÃO são
    // reenviados: ao reconectar, o cliente refaz a leitura do lote e do histórico.
    raw.write("retry: 3000\n\n");
    send("ready", { lotId: id, serverNow: new Date().toISOString() });

    const unsubscribe = subscribeLotEvents(id, (event) => send(event.type, event));
    const heartbeat = setInterval(() => send("ping", { serverNow: new Date().toISOString() }), heartbeatMs);

    // Sem isto cada aba fechada deixaria um assinante e um timer vivos para sempre.
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
