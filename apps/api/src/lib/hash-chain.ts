import { createHmac } from "node:crypto";
import { env } from "../config/env.js";

// Cadeia de hash dos lances: cada lance carrega o hash do anterior, então
// alterar, remover ou inserir qualquer lance muda todos os hashes seguintes.
// É HMAC (e não SHA puro) para que quem só tem acesso ao banco, sem o
// AUDIT_SECRET, não consiga recomputar uma cadeia forjada que pareça válida.

export type GenesisInput = {
  lotId: string;
  auctioneerId: string;
  startingBidCents: bigint;
  minIncrementCents: bigint;
  startsAt: Date;
};

export type BidHashInput = {
  prevHash: string;
  lotId: string;
  seq: number;
  alias: string;
  amountCents: bigint;
  placedAt: Date;
};

function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// O genesis amarra a cadeia aos parâmetros do lote. `ends_at` fica de fora
// de propósito: o anti-sniping o altera depois, e o genesis precisa ser
// recalculável a qualquer momento só com campos imutáveis.
export function genesisHash(input: GenesisInput, secret: string = env.AUDIT_SECRET): string {
  return hmac(
    secret,
    [
      "genesis",
      input.lotId,
      input.auctioneerId,
      input.startingBidCents.toString(),
      input.minIncrementCents.toString(),
      input.startsAt.toISOString(),
    ].join("|"),
  );
}

// `alias` (e não bidder_id) entra no hash porque é o que a auditoria pública
// mostra: quem confere a cadeia de fora enxerga exatamente os mesmos campos.
// Separador "|" é seguro: uuid, inteiros, ISO-8601 e "Licitante #xxxx" não o contêm.
export function computeBidHash(input: BidHashInput, secret: string = env.AUDIT_SECRET): string {
  return hmac(
    secret,
    [
      input.prevHash,
      input.lotId,
      input.seq.toString(),
      input.alias,
      input.amountCents.toString(),
      input.placedAt.toISOString(),
    ].join("|"),
  );
}
