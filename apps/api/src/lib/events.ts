import { EventEmitter } from "node:events";

// Pub/sub em memória, por lote. Limitação conhecida e documentada: funciona
// em instância única; com várias instâncias do backend, um lance numa não
// chega aos assinantes SSE da outra (precisaria de Redis/LISTEN-NOTIFY).

export type BidPlacedEvent = {
  type: "bid_placed";
  lotId: string;
  bid: { seq: number; bidderAlias: string; amountCents: number; placedAt: string };
  currentBidCents: number;
  bidCount: number;
  leaderAlias: string;
  endsAt: string;
  // true quando o anti-sniping empurrou o encerramento neste lance.
  extended: boolean;
  serverNow: string;
};

export type LotClosedEvent = {
  type: "lot_closed";
  lotId: string;
  // null quando o lote encerrou sem lances.
  winnerAlias: string | null;
  finalPriceCents: number | null;
  closedAt: string;
  serverNow: string;
};

export type LotCancelledEvent = {
  type: "lot_cancelled";
  lotId: string;
  serverNow: string;
};

export type LotEvent = BidPlacedEvent | LotClosedEvent | LotCancelledEvent;

const emitter = new EventEmitter();
// Uma sala com muitos espectadores gera muitos assinantes do mesmo canal.
emitter.setMaxListeners(0);

const channel = (lotId: string) => `lot:${lotId}`;

export function publishLotEvent(event: LotEvent): void {
  emitter.emit(channel(event.lotId), event);
}

// Quantos assinantes (conexões SSE) o lote tem agora; usado pelos testes para
// provar que desconectar libera o assinante.
export function lotListenerCount(lotId: string): number {
  return emitter.listenerCount(channel(lotId));
}

export function subscribeLotEvents(lotId: string, handler: (event: LotEvent) => void): () => void {
  emitter.on(channel(lotId), handler);
  return () => emitter.off(channel(lotId), handler);
}
