import { describe, expect, it } from "vitest";
import type { BidStatus, MyBid } from "../api/wins";
import { bidAction, bidStatusText, countByTab, emptyCopy, filterByTab, parseBidTab } from "./myBids";

function bid(lotId: string, status: BidStatus, overrides: Partial<MyBid> = {}): MyBid {
  return {
    lotId,
    title: `Lot ${lotId}`,
    imageUrl: null,
    phase: status === "won" || status === "lost" ? "ended" : "live",
    endsAt: "2026-10-28T20:00:00.000Z",
    status,
    myHighestBidCents: 10_000,
    myBidCount: 1,
    currentBidCents: 10_000,
    receiptToken: status === "won" ? `token-${lotId}` : null,
    issuedAt: status === "won" ? "2026-10-28T21:00:00.000Z" : null,
    lastBidAt: "2026-10-28T19:00:00.000Z",
    ...overrides,
  };
}

const mixed = [bid("a", "leading"), bid("b", "outbid"), bid("c", "won"), bid("d", "lost"), bid("e", "leading")];

describe("parseBidTab", () => {
  it("accepts the four tabs and falls back to all for anything else", () => {
    expect(parseBidTab("won")).toBe("won");
    expect(parseBidTab("active")).toBe("active");
    expect(parseBidTab("lost")).toBe("lost");
    expect(parseBidTab("all")).toBe("all");
    expect(parseBidTab(null)).toBe("all");
    expect(parseBidTab("<script>")).toBe("all");
    expect(parseBidTab("")).toBe("all");
  });
});

describe("filterByTab", () => {
  it("keeps everything on all", () => {
    expect(filterByTab(mixed, "all")).toHaveLength(5);
  });

  it("treats leading and outbid as in dispute", () => {
    expect(filterByTab(mixed, "active").map((item) => item.lotId)).toEqual(["a", "b", "e"]);
  });

  it("splits won from lost", () => {
    expect(filterByTab(mixed, "won").map((item) => item.lotId)).toEqual(["c"]);
    expect(filterByTab(mixed, "lost").map((item) => item.lotId)).toEqual(["d"]);
  });

  it("does not mutate the input", () => {
    const copy = [...mixed];
    filterByTab(mixed, "won");
    expect(mixed).toEqual(copy);
  });
});

describe("countByTab", () => {
  it("counts each tab, and active + won + lost always add up to all", () => {
    const counts = countByTab(mixed);
    expect(counts).toEqual({ all: 5, active: 3, won: 1, lost: 1 });
    expect(counts.active + counts.won + counts.lost).toBe(counts.all);
  });

  it("is all zeros for no bids", () => {
    expect(countByTab([])).toEqual({ all: 0, active: 0, won: 0, lost: 0 });
  });
});

describe("bidStatusText", () => {
  it("names every status", () => {
    expect(bidStatusText("leading")).toBe("Liderando");
    expect(bidStatusText("outbid")).toBe("Superado");
    expect(bidStatusText("won")).toBe("Arrematado");
    expect(bidStatusText("lost")).toBe("Não arrematado");
  });
});

describe("bidAction", () => {
  it("sends a won lot to the receipt, which is the required deliverable", () => {
    expect(bidAction(bid("c", "won"))).toBe("receipt");
  });

  it("never offers a receipt that does not exist", () => {
    expect(bidAction(bid("c", "won", { receiptToken: null }))).toBe("audit");
  });

  it("invites to cover only while the lot is still live", () => {
    expect(bidAction(bid("b", "outbid"))).toBe("cover");
    expect(bidAction(bid("b", "outbid", { phase: "ended" }))).toBe("room");
  });

  it("goes to the room when leading and to the audit when lost", () => {
    expect(bidAction(bid("a", "leading"))).toBe("room");
    expect(bidAction(bid("d", "lost"))).toBe("audit");
  });
});

describe("emptyCopy", () => {
  it("has a specific message for every tab", () => {
    const titles = (["all", "active", "won", "lost"] as const).map((tab) => emptyCopy(tab).title);
    expect(new Set(titles).size).toBe(4);
    expect(emptyCopy("won").text).toContain("comprovante");
  });
});
