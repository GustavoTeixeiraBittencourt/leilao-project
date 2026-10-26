import { describe, expect, it } from "vitest";
import type { Lot } from "../api/lots";
import { pickFeatured, sortLots } from "./lots";

function lot(overrides: Partial<Lot> & { id: string }): Lot {
  return {
    title: overrides.id,
    imageUrl: "https://www.artic.edu/iiif/2/x/full/843,/0/default.jpg",
    attributes: {},
    startingBidCents: 10_000,
    minIncrementCents: 1_000,
    startsAt: "2026-10-26T10:00:00.000Z",
    endsAt: "2026-10-27T10:00:00.000Z",
    status: "open",
    phase: "live",
    currentBidCents: null,
    bidCount: 0,
    leaderAlias: null,
    winnerAlias: null,
    finalPriceCents: null,
    serverNow: "2026-10-26T12:00:00.000Z",
    ...overrides,
  };
}

describe("sortLots", () => {
  const a = lot({ id: "a", currentBidCents: 20_000, bidCount: 2 });
  const b = lot({ id: "b", currentBidCents: 90_000, bidCount: 1 });
  const c = lot({ id: "c", currentBidCents: null, bidCount: 7 }); // sem lances: vale o inicial (10.000)

  it("keeps the server order by default and does not mutate the input", () => {
    const input = [a, b, c];
    expect(sortLots(input, "default").map((l) => l.id)).toEqual(["a", "b", "c"]);
    sortLots(input, "highest");
    expect(input.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("orders by the highest price, using the starting bid when there are no bids", () => {
    expect(sortLots([a, b, c], "highest").map((l) => l.id)).toEqual(["b", "a", "c"]);
  });

  it("uses the final price for closed lots", () => {
    const sold = lot({ id: "sold", phase: "ended", finalPriceCents: 500_000, currentBidCents: 500_000 });
    expect(sortLots([a, sold], "highest")[0]!.id).toBe("sold");
  });

  it("orders by the number of bids", () => {
    expect(sortLots([a, b, c], "most-bids").map((l) => l.id)).toEqual(["c", "a", "b"]);
  });
});

describe("pickFeatured", () => {
  it("returns null when nothing is live", () => {
    expect(pickFeatured([])).toBeNull();
  });

  it("picks the live lot with the most bids", () => {
    const quiet = lot({ id: "quiet", bidCount: 1 });
    const hot = lot({ id: "hot", bidCount: 9 });
    expect(pickFeatured([quiet, hot])?.id).toBe("hot");
  });

  it("breaks ties by the soonest ending", () => {
    const later = lot({ id: "later", bidCount: 3, endsAt: "2026-10-28T10:00:00.000Z" });
    const sooner = lot({ id: "sooner", bidCount: 3, endsAt: "2026-10-27T10:00:00.000Z" });
    expect(pickFeatured([later, sooner])?.id).toBe("sooner");
  });

  it("prefers a lot that has an image, even with fewer bids", () => {
    const noImage = lot({ id: "no-image", bidCount: 50, imageUrl: null });
    const withImage = lot({ id: "with-image", bidCount: 1 });
    expect(pickFeatured([noImage, withImage])?.id).toBe("with-image");
  });

  it("falls back to a lot without image when none has one", () => {
    expect(pickFeatured([lot({ id: "only", imageUrl: null })])?.id).toBe("only");
  });
});
