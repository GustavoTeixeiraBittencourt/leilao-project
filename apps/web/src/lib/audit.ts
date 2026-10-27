import type { AuditResult, BreakReason } from "../api/audit";

// Interpretação do resultado da auditoria. O servidor já decidiu o veredito (recalculou
// a cadeia com o segredo, que o navegador não tem); aqui só se traduz o que ele disse
// em texto e em marcas por linha, sem refazer nenhuma conta criptográfica.

// Quebras "da cadeia": o lance em `seq` não confere com o que veio antes. Os lances
// anteriores a ele conferem; ele é o ponto de quebra; os seguintes deixam de ser confiáveis.
// As demais quebras (contagem, resumo do lote, selo, comprovante) acontecem FORA da cadeia:
// os elos se recalculam normalmente, mas o que está gravado ao lado não bate.
const CHAIN_REASONS: ReadonlySet<BreakReason> = new Set(["SEQ_GAP", "PREV_HASH_MISMATCH", "HASH_MISMATCH"]);

export function isChainBreak(reason: BreakReason): boolean {
  return CHAIN_REASONS.has(reason);
}

export type RowStatus = "ok" | "break" | "untrusted";

export function rowStatus(seq: number, firstBreak: AuditResult["firstBreak"]): RowStatus {
  if (!firstBreak || !isChainBreak(firstBreak.reason)) return "ok";
  if (seq < firstBreak.seq) return "ok";
  return seq === firstBreak.seq ? "break" : "untrusted";
}

export const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  ok: "✓ confere",
  break: "× quebra aqui",
  untrusted: "! não confiável",
};

// "N de M": quantos lances foram conferidos até a primeira quebra.
export function verifiedCount(audit: Pick<AuditResult, "bids" | "firstBreak">): number {
  const total = audit.bids.length;
  const brk = audit.firstBreak;
  if (!brk || !isChainBreak(brk.reason)) return total;
  return Math.min(Math.max(brk.seq - 1, 0), total);
}

const REASON_LABEL: Record<BreakReason, string> = {
  SEQ_GAP: "Sequência interrompida",
  PREV_HASH_MISMATCH: "Encadeamento rompido",
  HASH_MISMATCH: "Conteúdo do lance alterado",
  BID_COUNT_MISMATCH: "Contagem de lances do lote",
  LOT_SUMMARY_MISMATCH: "Resumo do lote",
  SEAL_MISMATCH: "Selo do lote",
  RECEIPT_MISMATCH: "Comprovante",
};

// Valor do cartão "Primeiro ponto de quebra".
export function breakPointLabel(firstBreak: AuditResult["firstBreak"]): { value: string; detail: string | null } {
  if (!firstBreak) return { value: "Nenhum", detail: null };
  const detail = REASON_LABEL[firstBreak.reason];
  return isChainBreak(firstBreak.reason) ? { value: `Lance #${firstBreak.seq}`, detail } : { value: detail, detail: null };
}

// Texto do painel de veredito.
export function verdictMessage(audit: AuditResult): string {
  const { firstBreak, sealed } = audit;
  const total = audit.bids.length;

  if (!firstBreak) {
    if (total === 0) {
      return sealed
        ? "O lote encerrou sem lances e o selo gravado confere. Nada foi inserido depois."
        : "Ainda não há lances para conferir. Nenhum lance foi inserido fora do fluxo normal.";
    }
    return sealed
      ? `Todos os ${total} lances foram recalculados e conferem com o selo gravado no encerramento do lote. Nada foi alterado, removido ou inserido.`
      : `Todos os ${total} lances foram recalculados e a cadeia confere até o último lance registrado. O selo final só existe depois do encerramento do lote.`;
  }

  switch (firstBreak.reason) {
    case "SEQ_GAP":
      return `A sequência de lances está interrompida no lance #${firstBreak.seq}: ele está ausente ou fora de ordem. Os lances a partir dele não podem ser considerados confiáveis.`;
    case "PREV_HASH_MISMATCH":
    case "HASH_MISMATCH":
      return `A cadeia não confere a partir do lance #${firstBreak.seq}. Esse lance e os seguintes não podem ser considerados confiáveis.`;
    case "BID_COUNT_MISMATCH":
      return "O número de lances registrado no lote não bate com a cadeia recalculada.";
    case "LOT_SUMMARY_MISMATCH":
      return "O lance atual ou o líder gravado no lote não bate com o último lance da cadeia.";
    case "SEAL_MISMATCH":
      return "O selo gravado no encerramento do lote não bate com a cadeia recalculada.";
    case "RECEIPT_MISMATCH":
      return "O comprovante emitido não bate com o resultado e o selo do lote.";
  }
}

// Hash abreviado para a tabela; o valor completo fica no `title` da célula.
export function shortHash(hash: string): string {
  return hash.length > 10 ? `${hash.slice(0, 8)}…` : hash;
}

// Fim do selo, para o cartão "Selo final do lote" ("…c91e").
export function sealTail(hash: string | null | undefined): string {
  return hash ? `…${hash.slice(-4)}` : "—";
}

// "REC-DOLGMHVG": número do comprovante derivado do token público (só exibição).
export function receiptNumber(token: string): string {
  return `REC-${token.slice(0, 8).toUpperCase()}`;
}
