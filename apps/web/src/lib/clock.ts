// Relógio do servidor. O cliente NUNCA decide se um lote acabou: ele só calcula a
// contagem regressiva a partir de um offset entre o relógio do servidor e o dele,
// recalibrado a cada resposta HTTP e a cada evento SSE que trazem `serverNow`.

let offsetMs = 0;

// offset = (hora do servidor) - (hora do cliente no momento em que a resposta chegou).
export function syncServerClock(serverNowIso: string, clientNowMs: number = Date.now()): void {
  const serverMs = Date.parse(serverNowIso);
  if (!Number.isNaN(serverMs)) offsetMs = serverMs - clientNowMs;
}

export function serverNowMs(clientNowMs: number = Date.now()): number {
  return clientNowMs + offsetMs;
}

// Quanto falta (em ms) para `endsAtIso`, segundo o relógio do servidor. Nunca negativo.
export function remainingMs(endsAtIso: string, clientNowMs: number = Date.now()): number {
  return Math.max(0, Date.parse(endsAtIso) - serverNowMs(clientNowMs));
}

const pad = (value: number) => String(value).padStart(2, "0");

// "02:14:09" (number/m do Figma); com dias: "2d 02:14:09".
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

// Só para testes: volta ao estado inicial.
export function resetServerClock(): void {
  offsetMs = 0;
}
