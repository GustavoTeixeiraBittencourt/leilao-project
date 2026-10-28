import { closeDueLots } from "../modules/settlement/service.js";

type Logger = {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

export type Closer = { stop: () => Promise<void> };

// Worker de encerramento: roda no mesmo processo do servidor, sem depender de
// tráfego. Usa setTimeout encadeado (e não setInterval) para que um tick lento
// nunca se sobreponha ao seguinte. O primeiro tick é imediato: ao subir depois
// de uma hibernação (plano gratuito), os lotes vencidos fecham na hora.
export function startCloser(options: { intervalMs: number; logger: Logger }): Closer {
  const { intervalMs, logger } = options;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const tick = async () => {
    try {
      const closed = await closeDueLots(undefined, (lotId, err) =>
        logger.error({ err, lotId }, "closer: lot skipped, settlement failed"),
      );
      if (closed > 0) logger.info({ closed }, "closer: settled due lots");
    } catch (error) {
      // Nunca deixar o loop morrer: o próximo tick tenta de novo.
      logger.error({ err: error }, "closer: tick failed");
    }
  };

  const schedule = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = tick().finally(() => schedule(intervalMs));
    }, delayMs);
  };

  schedule(0);

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running; // deixa o tick em andamento terminar a transação
    },
  };
}
