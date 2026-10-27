import { describe, expect, it } from "vitest";
import type { Bid, BidPlacedEvent } from "../api/bids";
import type { Lot } from "../api/lots";
import { centsToInput, parseMoneyToCents } from "./money";
import {
  applyBidPlaced,
  applyLotCancelled,
  applyLotClosed,
  mergeBid,
  minNextBidCents,
  needsPhaseRefresh,
  remainingAnnouncement,
  standingOf,
} from "./room";

function lot(overrides: Partial<Lot> = {}): Lot {
  return {
    id: "lot-1",
    title: "Self-Portrait",
    imageUrl: null,
    attributes: {},
    startingBidCents: 10_000,
    minIncrementCents: 500,
    startsAt: "2026-10-27T10:00:00.000Z",
    endsAt: "2026-10-27T12:00:00.000Z",
    status: "open",
    phase: "live",
    currentBidCents: null,
    bidCount: 0,
    leaderAlias: null,
    winnerAlias: null,
    finalPriceCents: null,
    serverNow: "2026-10-27T11:00:00.000Z",
    ...overrides,
  };
}

function bid(seq: number, alias: string, amountCents: number): Bid {
  return { seq, bidderAlias: alias, amountCents, placedAt: "2026-10-27T11:00:00.000Z" };
}

function placed(overrides: Partial<BidPlacedEvent> = {}): BidPlacedEvent {
  return {
    type: "bid_placed",
    lotId: "lot-1",
    bid: bid(1, "Licitante #aaaa", 10_000),
    currentBidCents: 10_000,
    bidCount: 1,
    leaderAlias: "Licitante #aaaa",
    endsAt: "2026-10-27T12:00:00.000Z",
    extended: false,
    serverNow: "2026-10-27T11:00:01.000Z",
    ...overrides,
  };
}

describe("parseMoneyToCents", () => {
  it.each([
    ["12.950,00", 1_295_000],
    ["12950,00", 1_295_000],
    ["12950", 1_295_000],
    ["12.950", 1_295_000], // sem vírgula: ponto é milhar (padrão brasileiro)
    ["12950,5", 1_295_050],
    ["12950.5", 1_295_050],
    ["US$ 12.950,00", 1_295_000],
    ["0,01", 1],
    ["1.234.567,89", 123_456_789],
  ])("parses %s", (text, cents) => {
    expect(parseMoneyToCents(text)).toBe(cents);
  });

  it.each(["", "abc", "0", "0,00", "-5", "12,345", "12..5", "1,2,3", "12.95.0"])("rejects %j", (text) => {
    expect(parseMoneyToCents(text)).toBeNull();
  });

  it("rejects values above the API ceiling", () => {
    expect(parseMoneyToCents("1.000.000.001,00")).toBeNull();
  });

  it("round-trips with centsToInput", () => {
    for (const cents of [1, 99, 100, 1_295_000, 123_456_789]) {
      expect(parseMoneyToCents(centsToInput(cents))).toBe(cents);
    }
  });
});

describe("minNextBidCents", () => {
  it("is the starting bid before any bid", () => {
    expect(minNextBidCents(lot())).toBe(10_000);
  });

  it("is current bid + increment afterwards", () => {
    expect(minNextBidCents(lot({ bidCount: 3, currentBidCents: 12_000 }))).toBe(12_500);
  });
});

describe("applyBidPlaced", () => {
  it("updates current bid, count, leader and end time", () => {
    const next = applyBidPlaced(lot(), placed({ endsAt: "2026-10-27T12:02:00.000Z", extended: true }));
    expect(next).toMatchObject({
      currentBidCents: 10_000,
      bidCount: 1,
      leaderAlias: "Licitante #aaaa",
      endsAt: "2026-10-27T12:02:00.000Z",
    });
  });

  it("ignores a repeated or older event (POST response + SSE for the same bid)", () => {
    const current = lot({ bidCount: 2, currentBidCents: 11_000, leaderAlias: "Licitante #bbbb" });
    expect(applyBidPlaced(current, placed({ bidCount: 2 }))).toBe(current);
    expect(applyBidPlaced(current, placed({ bidCount: 1 }))).toBe(current);
  });
});

describe("applyLotClosed / applyLotCancelled", () => {
  it("closes with the winner and the final price", () => {
    const closed = applyLotClosed(lot(), {
      type: "lot_closed",
      lotId: "lot-1",
      winnerAlias: "Licitante #aaaa",
      finalPriceCents: 12_000,
      closedAt: "2026-10-27T12:00:00.000Z",
      serverNow: "2026-10-27T12:00:00.000Z",
    });
    expect(closed).toMatchObject({ status: "closed", phase: "ended", winnerAlias: "Licitante #aaaa", finalPriceCents: 12_000 });
  });

  it("closes without a winner when there were no bids", () => {
    const closed = applyLotClosed(lot(), {
      type: "lot_closed",
      lotId: "lot-1",
      winnerAlias: null,
      finalPriceCents: null,
      closedAt: "2026-10-27T12:00:00.000Z",
      serverNow: "2026-10-27T12:00:00.000Z",
    });
    expect(closed.winnerAlias).toBeNull();
    expect(closed.phase).toBe("ended");
  });

  it("marks the lot as cancelled", () => {
    const cancelled = applyLotCancelled(lot(), { type: "lot_cancelled", lotId: "lot-1", serverNow: "x" });
    expect(cancelled).toMatchObject({ status: "cancelled", phase: "cancelled" });
  });
});

describe("mergeBid", () => {
  it("keeps bids ordered by seq and never duplicates one", () => {
    let bids: Bid[] = [bid(1, "a", 100)];
    bids = mergeBid(bids, bid(3, "c", 300));
    bids = mergeBid(bids, bid(2, "b", 200));
    bids = mergeBid(bids, bid(2, "b", 200));
    expect(bids.map((b) => b.seq)).toEqual([1, 2, 3]);
  });

  it("returns the same array when the bid is already there", () => {
    const bids = [bid(1, "a", 100)];
    expect(mergeBid(bids, bid(1, "a", 100))).toBe(bids);
  });
});

describe("standingOf", () => {
  const bids = [bid(1, "Licitante #me", 100), bid(2, "Licitante #other", 200)];

  it("is leading when the user leads", () => {
    expect(standingOf(lot({ leaderAlias: "Licitante #me" }), bids, "Licitante #me")).toBe("leading");
  });

  it("is outbid when the user has a bid but someone else leads", () => {
    expect(standingOf(lot({ leaderAlias: "Licitante #other" }), bids, "Licitante #me")).toBe("outbid");
  });

  it("is none when the user never bid, or is logged out", () => {
    expect(standingOf(lot({ leaderAlias: "Licitante #other" }), bids, "Licitante #new")).toBe("none");
    expect(standingOf(lot({ leaderAlias: "Licitante #other" }), bids, null)).toBe("none");
  });
});

describe("needsPhaseRefresh", () => {
  const at = (iso: string) => Date.parse(iso);

  it("asks again when a live lot passed its end", () => {
    expect(needsPhaseRefresh(lot(), at("2026-10-27T12:00:00.000Z"))).toBe(true);
    expect(needsPhaseRefresh(lot(), at("2026-10-27T11:59:59.000Z"))).toBe(false);
  });

  it("asks again when a scheduled lot passed its start", () => {
    const scheduled = lot({ phase: "scheduled" });
    expect(needsPhaseRefresh(scheduled, at("2026-10-27T10:00:00.000Z"))).toBe(true);
    expect(needsPhaseRefresh(scheduled, at("2026-10-27T09:59:59.000Z"))).toBe(false);
  });

  it("never asks for ended or cancelled lots", () => {
    expect(needsPhaseRefresh(lot({ phase: "ended" }), at("2030-01-01T00:00:00.000Z"))).toBe(false);
    expect(needsPhaseRefresh(lot({ phase: "cancelled" }), at("2030-01-01T00:00:00.000Z"))).toBe(false);
  });
});

describe("remainingAnnouncement", () => {
  const min = 60_000;

  it("only changes text when the range changes, not every second", () => {
    expect(remainingAnnouncement(125 * min + 1_000)).toBe(remainingAnnouncement(125 * min + 40_000));
    expect(remainingAnnouncement(34 * min)).toBe(remainingAnnouncement(31 * min));
  });

  it("is precise near the end", () => {
    expect(remainingAnnouncement(0)).toBe("Lote encerrando.");
    expect(remainingAnnouncement(30_000)).toBe("Falta menos de 1 minuto para o encerramento.");
    expect(remainingAnnouncement(1 * min)).toBe("Faltam 1 minuto para o encerramento.");
    expect(remainingAnnouncement(5 * min)).toBe("Faltam 5 minutos para o encerramento.");
    expect(remainingAnnouncement(2 * 60 * min)).toBe("Faltam 2 horas para o encerramento.");
  });
});
