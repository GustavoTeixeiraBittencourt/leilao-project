import { describe, expect, it } from "vitest";
import type { AuditResult } from "../api/audit";
import { breakPointLabel, receiptNumber, rowStatus, sealTail, shortHash, verdictMessage, verifiedCount } from "./audit";

function audit(overrides: Partial<AuditResult> = {}): AuditResult {
  const bids = [1, 2, 3, 4, 5].map((seq) => ({
    seq,
    bidderAlias: `Licitante #${seq}`,
    amountCents: seq * 1000,
    placedAt: "2026-10-27T18:00:00.000Z",
    prevHash: "p".repeat(64),
    hash: "h".repeat(64),
  }));
  return {
    verdict: "intact",
    firstBreak: null,
    sealed: true,
    checkedBids: bids.length,
    lot: {
      id: "lot-1",
      title: "Self-Portrait",
      imageUrl: null,
      status: "closed",
      phase: "ended",
      startsAt: "2026-10-27T10:00:00.000Z",
      endsAt: "2026-10-27T20:00:00.000Z",
      startingBidCents: 1000,
      minIncrementCents: 100,
      bidCount: bids.length,
      currentBidCents: 5000,
      finalPriceCents: 5000,
      winnerAlias: "Licitante #5",
    },
    seal: { count: 5, hash: "abcdef1234567890c91e" },
    bids,
    serverNow: "2026-10-28T12:00:00.000Z",
    ...overrides,
  };
}

describe("rowStatus", () => {
  it("marks everything ok when the chain is intact", () => {
    expect([1, 2, 3].map((seq) => rowStatus(seq, null))).toEqual(["ok", "ok", "ok"]);
  });

  it("splits a chain break into ok / break / untrusted", () => {
    const brk = { seq: 3, reason: "HASH_MISMATCH" as const };
    expect([1, 2, 3, 4, 5].map((seq) => rowStatus(seq, brk))).toEqual(["ok", "ok", "break", "untrusted", "untrusted"]);
  });

  it("keeps every row ok when the break is outside the chain (seal, receipt, summary)", () => {
    // Os elos se recalculam normalmente; o que não bate é o que está gravado ao lado.
    for (const reason of ["SEAL_MISMATCH", "RECEIPT_MISMATCH", "BID_COUNT_MISMATCH", "LOT_SUMMARY_MISMATCH"] as const) {
      expect(rowStatus(5, { seq: 5, reason })).toBe("ok");
    }
  });

  it("treats a missing bid (gap) as the break and everything after it as untrusted", () => {
    // Cadeia 1,2,4,5: o servidor aponta seq 3 (o esperado). Os lances 4 e 5 ficam não confiáveis.
    const brk = { seq: 3, reason: "SEQ_GAP" as const };
    expect([1, 2, 4, 5].map((seq) => rowStatus(seq, brk))).toEqual(["ok", "ok", "untrusted", "untrusted"]);
  });
});

describe("verifiedCount", () => {
  it("counts all bids when intact", () => {
    expect(verifiedCount(audit())).toBe(5);
  });

  it("counts only the bids before a chain break", () => {
    expect(verifiedCount(audit({ firstBreak: { seq: 4, reason: "PREV_HASH_MISMATCH" } }))).toBe(3);
  });

  it("counts all bids when the break is outside the chain", () => {
    expect(verifiedCount(audit({ firstBreak: { seq: 5, reason: "RECEIPT_MISMATCH" } }))).toBe(5);
  });

  it("never goes negative or above the total", () => {
    expect(verifiedCount(audit({ firstBreak: { seq: 1, reason: "HASH_MISMATCH" } }))).toBe(0);
    expect(verifiedCount(audit({ firstBreak: { seq: 99, reason: "SEQ_GAP" } }))).toBe(5);
  });
});

describe("breakPointLabel", () => {
  it("says none when intact", () => {
    expect(breakPointLabel(null)).toEqual({ value: "Nenhum", detail: null });
  });

  it("points at the bid for chain breaks and names the cause", () => {
    expect(breakPointLabel({ seq: 4, reason: "HASH_MISMATCH" })).toEqual({
      value: "Lance #4",
      detail: "Conteúdo do lance alterado",
    });
  });

  it("names the cause (not a bid) for breaks outside the chain", () => {
    expect(breakPointLabel({ seq: 6, reason: "SEAL_MISMATCH" })).toEqual({ value: "Selo do lote", detail: null });
  });
});

describe("verdictMessage", () => {
  it("is honest that an open lot has no seal yet", () => {
    const text = verdictMessage(audit({ sealed: false, seal: null }));
    expect(text).toContain("5 lances");
    expect(text).toContain("O selo final só existe depois do encerramento");
    expect(text).not.toContain("conferem com o selo");
  });

  it("mentions the seal for a closed lot", () => {
    expect(verdictMessage(audit())).toContain("conferem com o selo gravado no encerramento");
  });

  it("handles a closed lot with no bids", () => {
    expect(verdictMessage(audit({ bids: [], checkedBids: 0 }))).toContain("sem lances");
  });

  it("names the first broken bid", () => {
    const text = verdictMessage(audit({ verdict: "tampered", firstBreak: { seq: 4, reason: "HASH_MISMATCH" } }));
    expect(text).toContain("lance #4");
  });

  it("covers every reason with a distinct message", () => {
    const reasons = [
      "SEQ_GAP",
      "PREV_HASH_MISMATCH",
      "HASH_MISMATCH",
      "BID_COUNT_MISMATCH",
      "LOT_SUMMARY_MISMATCH",
      "SEAL_MISMATCH",
      "RECEIPT_MISMATCH",
    ] as const;
    const messages = reasons.map((reason) => verdictMessage(audit({ firstBreak: { seq: 2, reason } })));
    expect(new Set(messages).size).toBe(messages.length - 1); // PREV_HASH e HASH_MISMATCH compartilham o texto
  });
});

describe("display helpers", () => {
  it("shortens a hash but keeps short values", () => {
    expect(shortHash("0123456789abcdef")).toBe("01234567…");
    expect(shortHash("abc")).toBe("abc");
  });

  it("shows the tail of the seal", () => {
    expect(sealTail("abcdef1234567890c91e")).toBe("…c91e");
    expect(sealTail(null)).toBe("—");
  });

  it("derives a receipt number from the token", () => {
    expect(receiptNumber("DOlgMHVGCzi7qy2w84YzKQ")).toBe("REC-DOLGMHVG");
  });
});
