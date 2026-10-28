import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  bidsQueryKey,
  type Bid,
  type BidPlacedEvent,
  type LotCancelledEvent,
  type LotClosedEvent,
} from "../api/bids";
import { API_URL } from "../api/client";
import { lotQueryKey, type Lot } from "../api/lots";
import { syncServerClock } from "../lib/clock";
import { applyBidPlaced, applyLotCancelled, applyLotClosed, mergeBid } from "../lib/room";

export type StreamStatus = "connecting" | "live" | "reconnecting";

function parse<T>(event: Event): T | null {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as T;
  } catch {
    return null;
  }
}

// Liga a sala ao SSE do lote e escreve os eventos direto no cache do React Query: a
// tela só lê do cache, então não há um segundo estado para ficar fora de sincronia.
//
// O servidor NÃO reenvia o que se perdeu durante uma queda. Por isso, a cada "ready"
// (a 1ª conexão E toda reconexão automática do EventSource) o lote e o histórico são
// relidos: cobre o intervalo entre a leitura inicial e a abertura do stream, e o
// buraco de uma reconexão.
export function useLotStream(lotId: string, enabled: boolean): StreamStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>("connecting");

  useEffect(() => {
    if (!enabled) return;
    setStatus("connecting");
    const source = new EventSource(`${API_URL}/lots/${lotId}/events`);

    const updateLot = (update: (lot: Lot) => Lot) =>
      queryClient.setQueryData<Lot>(lotQueryKey(lotId), (lot) => (lot ? update(lot) : lot));

    source.addEventListener("ready", (event) => {
      const data = parse<{ serverNow: string }>(event);
      if (data) syncServerClock(data.serverNow);
      setStatus("live");
      void queryClient.invalidateQueries({ queryKey: lotQueryKey(lotId) });
      void queryClient.invalidateQueries({ queryKey: bidsQueryKey(lotId) });
    });

    source.addEventListener("ping", (event) => {
      const data = parse<{ serverNow: string }>(event);
      if (data) syncServerClock(data.serverNow);
    });

    source.addEventListener("bid_placed", (event) => {
      const data = parse<BidPlacedEvent>(event);
      if (!data) return;
      syncServerClock(data.serverNow);
      updateLot((lot) => applyBidPlaced(lot, data));
      queryClient.setQueryData<Bid[]>(bidsQueryKey(lotId), (list) => (list ? mergeBid(list, data.bid) : list));
    });

    source.addEventListener("lot_closed", (event) => {
      const data = parse<LotClosedEvent>(event);
      if (!data) return;
      syncServerClock(data.serverNow);
      updateLot((lot) => applyLotClosed(lot, data));
    });

    source.addEventListener("lot_cancelled", (event) => {
      const data = parse<LotCancelledEvent>(event);
      if (!data) return;
      syncServerClock(data.serverNow);
      updateLot((lot) => applyLotCancelled(lot, data));
    });

    // O EventSource reconecta sozinho (retry de 3s enviado pelo servidor); aqui só se
    // avisa o usuário de que a tela pode estar atrasada.
    source.onerror = () => setStatus("reconnecting");

    return () => source.close();
  }, [lotId, enabled, queryClient]);

  return status;
}
