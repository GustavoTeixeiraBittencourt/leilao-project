import type { MyLot } from "../api/auctioneer";
import { formatMoney } from "./format";
import { parseMoneyToCents } from "./money";

// Regras puras do painel do leiloeiro (fora dos componentes para testar sem React).

export type Kpis = {
  live: number;
  scheduled: number;
  ended: number;
  endedSold: number;
  endedUnsold: number;
};

// Cancelados não entram nos KPIs (o Figma só conta ao vivo, agendados e encerrados).
export function computeKpis(lots: MyLot[]): Kpis {
  const kpis: Kpis = { live: 0, scheduled: 0, ended: 0, endedSold: 0, endedUnsold: 0 };
  for (const lot of lots) {
    if (lot.phase === "live") kpis.live += 1;
    else if (lot.phase === "scheduled") kpis.scheduled += 1;
    else if (lot.phase === "ended") {
      kpis.ended += 1;
      if (lot.sold) kpis.endedSold += 1;
      else kpis.endedUnsold += 1;
    }
  }
  return kpis;
}

// Texto da coluna "Resultado / ação". O Figma separa os casos: arrematado, com lances
// (não dá para cancelar), sem lances (pode cancelar), sem vencedor e cancelado.
export function resultText(lot: MyLot): string {
  switch (lot.phase) {
    case "ended":
      return lot.sold && lot.winnerAlias && lot.finalPriceCents !== null
        ? `Arrematado por ${lot.winnerAlias} · recebido ${formatMoney(lot.finalPriceCents)}`
        : "Encerrado sem lances · sem vencedor";
    case "cancelled":
      return "Cancelado · não aparece na vitrine";
    case "live":
    case "scheduled":
      return lot.bidCount === 0
        ? "Sem lances · pode ser cancelado"
        : `${lot.bidCount} ${lot.bidCount === 1 ? "lance" : "lances"} · não é possível cancelar lote com lances`;
  }
}

// ---- Formulário "Novo lote" ----

const pad = (value: number) => String(value).padStart(2, "0");

// Valor de <input type="datetime-local">: "2026-10-29T14:00" no fuso do navegador.
export function toLocalInput(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "2026-10-29T14:00" (hora local do navegador) -> instante, ou null se vazio/inválido.
export function parseLocalInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export type LotFormValues = {
  startingBid: string;
  minIncrement: string;
  startsAt: string;
  endsAt: string;
};

export type LotFormErrors = Partial<Record<keyof LotFormValues, string>>;

export type LotFormCheck =
  | { ok: true; payload: { startingBidCents: number; minIncrementCents: number; startsAt: string; endsAt: string } }
  | { ok: false; errors: LotFormErrors };

// Valida o formulário espelhando o que a API exige (createLotSchema + "endsAt no futuro").
// `serverNow` vem do relógio do SERVIDOR: o cliente não decide o que é "futuro".
export function checkLotForm(values: LotFormValues, serverNow: number): LotFormCheck {
  const errors: LotFormErrors = {};

  const startingBidCents = parseMoneyToCents(values.startingBid);
  if (startingBidCents === null) errors.startingBid = "Informe um valor maior que zero, por exemplo 4.000,00.";

  const minIncrementCents = parseMoneyToCents(values.minIncrement);
  if (minIncrementCents === null) errors.minIncrement = "Informe um valor maior que zero, por exemplo 500,00.";

  const startsMs = parseLocalInput(values.startsAt);
  if (startsMs === null) errors.startsAt = "Informe a data e a hora de início.";

  const endsMs = parseLocalInput(values.endsAt);
  if (endsMs === null) errors.endsAt = "Informe a data e a hora de encerramento.";
  else if (endsMs <= serverNow) errors.endsAt = "O encerramento precisa estar no futuro.";
  else if (startsMs !== null && endsMs <= startsMs) errors.endsAt = "O encerramento precisa ser depois do início.";

  if (Object.keys(errors).length > 0 || startingBidCents === null || minIncrementCents === null || startsMs === null || endsMs === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    payload: {
      startingBidCents,
      minIncrementCents,
      startsAt: new Date(startsMs).toISOString(),
      endsAt: new Date(endsMs).toISOString(),
    },
  };
}

// Sugestão inicial: abre daqui a 5 min e dura 1 h, para o leiloeiro só ajustar.
export function defaultLotTimes(serverNow: number): { startsAt: string; endsAt: string } {
  const start = serverNow + 5 * 60_000;
  return { startsAt: toLocalInput(start), endsAt: toLocalInput(start + 60 * 60_000) };
}
