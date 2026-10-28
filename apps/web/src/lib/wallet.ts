import type { WalletBid, WalletBidStatus, WalletEntry, WalletEntryKind } from "../api/wallet";
import { formatMoney } from "./format";
import { centsToInput, parseMoneyToCents } from "./money";

// Teto por depósito: o mesmo da API (MAX_DEPOSIT_CENTS em wallet/schemas.ts). O Figma
// mostra "máximo US$ 50.000,00", mas quem decide é o servidor: o texto da tela e a
// validação usam o limite real para nunca prometer algo que a API recusaria.
export const MAX_DEPOSIT_CENTS = 100_000_000;

export type DepositCheck = { ok: true; cents: number } | { ok: false; error: string };

export function checkDeposit(text: string): DepositCheck {
  const cents = parseMoneyToCents(text);
  if (cents === null) return { ok: false, error: "Informe um valor válido, por exemplo 1.000,00." };
  if (cents > MAX_DEPOSIT_CENTS) {
    return { ok: false, error: `O máximo por depósito é ${formatMoney(MAX_DEPOSIT_CENTS)}.` };
  }
  return { ok: true, cents };
}

// Atalhos "+ 500": somam ao que já está no campo (vazio ou inválido conta como zero).
// Nunca passa do teto, para o atalho não gerar um valor que o servidor recusaria.
export function addToAmount(text: string, addCents: number): string {
  const current = parseMoneyToCents(text) ?? 0;
  return centsToInput(Math.min(current + addCents, MAX_DEPOSIT_CENTS));
}

const KIND_LABEL: Record<WalletEntryKind, string> = {
  deposit: "Depósito simulado",
  settlement_debit: "Débito de arremate",
  settlement_credit: "Crédito de venda",
  refund: "Estorno",
};

export function entryLabel(kind: WalletEntryKind): string {
  return KIND_LABEL[kind];
}

// ---- Extrato: lançamentos do ledger + meus lances ----

export type StatementRow =
  | { type: "entry"; key: string; at: string; entry: WalletEntry }
  | { type: "bid"; key: string; at: string; bid: WalletBid };

// Junta os lançamentos do ledger e os lances numa lista só, do mais novo para o mais antigo.
// Os lances NÃO são lançamentos: ficam só na exibição, o saldo vem do ledger. Em empate de
// horário o lançamento vem primeiro (a liquidação sempre acontece depois do último lance).
export function buildStatement(entries: WalletEntry[], bids: WalletBid[], limit = 50): StatementRow[] {
  const rows: StatementRow[] = [
    ...entries.map((entry) => ({ type: "entry" as const, key: `entry-${entry.id}`, at: entry.createdAt, entry })),
    ...bids.map((bid) => ({ type: "bid" as const, key: `bid-${bid.id}`, at: bid.placedAt, bid })),
  ];
  return rows
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.type === b.type ? 0 : a.type === "entry" ? -1 : 1))
    .slice(0, limit);
}

const BID_STATUS_LABEL: Record<WalletBidStatus, string> = {
  leading: "Liderando · valor reservado",
  outbid: "Superado · valor devolvido",
  won: "Arrematado · veja o débito",
};

export function bidStatusLabel(status: WalletBidStatus): string {
  return BID_STATUS_LABEL[status];
}

// "+ US$ 5.000,00" / "− US$ 1.150,00": o sinal vem do valor assinado do ledger.
export function formatSigned(cents: number): string {
  return `${cents < 0 ? "−" : "+"} ${formatMoney(Math.abs(cents))}`;
}
