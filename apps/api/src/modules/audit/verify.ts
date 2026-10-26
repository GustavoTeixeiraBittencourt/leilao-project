import type { Lot, Receipt } from "@prisma/client";
import type { ChainRow } from "../../db/locks.js";
import { computeBidHash, genesisHash } from "../../lib/hash-chain.js";

export type BreakReason =
  | "SEQ_GAP" // lance faltando, duplicado ou fora de ordem
  | "PREV_HASH_MISMATCH" // lance não aponta para o hash do anterior
  | "HASH_MISMATCH" // conteúdo do lance não bate com o hash gravado
  | "BID_COUNT_MISMATCH" // lote diz N lances, a cadeia tem outro número
  | "LOT_SUMMARY_MISMATCH" // lance atual/líder do lote não bate com o último lance
  | "SEAL_MISMATCH" // selo do lote encerrado não bate com a cadeia
  | "RECEIPT_MISMATCH"; // comprovante não bate com o lote/selo

export type Verdict = {
  verdict: "intact" | "tampered";
  // Primeiro ponto de quebra; null se íntegro. `seq` é o lance onde a
  // inconsistência aparece (ou o primeiro seq ausente).
  firstBreak: { seq: number; reason: BreakReason } | null;
  // Lote encerrado tem selo (contagem + hash final) gravado fora da cadeia;
  // lote aberto não: ver limite conhecido no README.
  sealed: boolean;
  checkedBids: number;
};

type LotForAudit = Pick<
  Lot,
  | "id"
  | "auctioneerId"
  | "status"
  | "startingBidCents"
  | "minIncrementCents"
  | "startsAt"
  | "bidCount"
  | "currentBidCents"
  | "leaderId"
  | "winnerId"
  | "finalPriceCents"
  | "sealCount"
  | "sealHash"
>;

// Recalcula a cadeia INTEIRA do zero (genesis -> lance 1 -> ... -> N) e
// confere cada elo; depois confere o que está gravado fora da cadeia (colunas
// derivadas do lote, selo e comprovante). Retorna no PRIMEIRO problema.
export function verifyLot(
  lot: LotForAudit,
  chain: ChainRow[],
  receipt: Pick<Receipt, "amountCents" | "sealCount" | "sealHash" | "winnerId"> | null,
): Verdict {
  const sealed = lot.status === "closed";
  const tampered = (seq: number, reason: BreakReason): Verdict => ({
    verdict: "tampered",
    firstBreak: { seq, reason },
    sealed,
    checkedBids: chain.length,
  });

  const genesis = genesisHash({
    lotId: lot.id,
    auctioneerId: lot.auctioneerId,
    startingBidCents: lot.startingBidCents,
    minIncrementCents: lot.minIncrementCents,
    startsAt: lot.startsAt,
  });

  let prevHash = genesis;
  for (const [index, row] of chain.entries()) {
    const expectedSeq = index + 1;
    if (row.seq !== expectedSeq) return tampered(expectedSeq, "SEQ_GAP");
    if (row.prev_hash !== prevHash) return tampered(row.seq, "PREV_HASH_MISMATCH");

    const expectedHash = computeBidHash({
      prevHash,
      lotId: lot.id,
      seq: row.seq,
      alias: row.alias,
      amountCents: row.amount_cents,
      placedAt: row.placed_at,
    });
    if (row.hash !== expectedHash) return tampered(row.seq, "HASH_MISMATCH");
    prevHash = row.hash;
  }

  // A cadeia está internamente coerente. Agora o que mora FORA dela.
  const last = chain.at(-1) ?? null;
  const headHash = last?.hash ?? genesis;

  if (lot.bidCount !== chain.length) {
    return tampered(Math.min(lot.bidCount, chain.length) + 1, "BID_COUNT_MISMATCH");
  }
  if (last && (lot.currentBidCents !== last.amount_cents || lot.leaderId !== last.bidder_id)) {
    return tampered(last.seq, "LOT_SUMMARY_MISMATCH");
  }
  if (!last && (lot.currentBidCents !== null || lot.leaderId !== null)) {
    return tampered(1, "LOT_SUMMARY_MISMATCH");
  }

  if (sealed) {
    if (lot.sealCount !== chain.length || lot.sealHash !== headHash) {
      return tampered(Math.min(lot.sealCount ?? 0, chain.length) + 1, "SEAL_MISMATCH");
    }
    const expectedWinner = last?.bidder_id ?? null;
    const expectedPrice = last?.amount_cents ?? null;
    if (lot.winnerId !== expectedWinner || lot.finalPriceCents !== expectedPrice) {
      return tampered(chain.length, "SEAL_MISMATCH");
    }
    if (last) {
      const receiptOk =
        receipt !== null &&
        receipt.winnerId === last.bidder_id &&
        receipt.amountCents === last.amount_cents &&
        receipt.sealCount === chain.length &&
        receipt.sealHash === headHash;
      if (!receiptOk) return tampered(chain.length, "RECEIPT_MISMATCH");
    } else if (receipt !== null) {
      return tampered(1, "RECEIPT_MISMATCH");
    }
  }

  return { verdict: "intact", firstBreak: null, sealed, checkedBids: chain.length };
}
