import { describe, expect, it } from "vitest";
import { computeBidHash, genesisHash, type BidHashInput, type GenesisInput } from "../src/lib/hash-chain.js";

const SECRET = "test-secret-0123456789abcdef";

const lot: GenesisInput = {
  lotId: "11111111-1111-1111-1111-111111111111",
  auctioneerId: "22222222-2222-2222-2222-222222222222",
  startingBidCents: 10_000n,
  minIncrementCents: 500n,
  startsAt: new Date("2026-10-26T12:00:00.000Z"),
};

const bid: BidHashInput = {
  prevHash: genesisHash(lot, SECRET),
  lotId: lot.lotId,
  seq: 1,
  alias: "Licitante #a3f9",
  amountCents: 10_000n,
  placedAt: new Date("2026-10-26T12:05:00.123Z"),
};

describe("hash chain", () => {
  it("is deterministic", () => {
    expect(computeBidHash(bid, SECRET)).toBe(computeBidHash({ ...bid }, SECRET));
    expect(genesisHash(lot, SECRET)).toBe(genesisHash({ ...lot }, SECRET));
  });

  it("changes when any bid field changes", () => {
    const original = computeBidHash(bid, SECRET);
    const tampered: Partial<BidHashInput>[] = [
      { prevHash: "0".repeat(64) },
      { lotId: "33333333-3333-3333-3333-333333333333" },
      { seq: 2 },
      { alias: "Licitante #ffff" },
      { amountCents: 10_001n },
      { placedAt: new Date("2026-10-26T12:05:00.124Z") },
    ];
    for (const change of tampered) {
      expect(computeBidHash({ ...bid, ...change }, SECRET)).not.toBe(original);
    }
  });

  it("changes when any lot parameter in the genesis changes", () => {
    const original = genesisHash(lot, SECRET);
    expect(genesisHash({ ...lot, startingBidCents: 10_001n }, SECRET)).not.toBe(original);
    expect(genesisHash({ ...lot, minIncrementCents: 501n }, SECRET)).not.toBe(original);
    expect(genesisHash({ ...lot, startsAt: new Date("2026-10-26T12:00:00.001Z") }, SECRET)).not.toBe(original);
    expect(genesisHash({ ...lot, auctioneerId: lot.lotId }, SECRET)).not.toBe(original);
  });

  it("cannot be recomputed without the secret", () => {
    expect(computeBidHash(bid, SECRET)).not.toBe(computeBidHash(bid, "another-secret-0123456789abcdef"));
  });

  it("chains: altering an earlier bid breaks every later hash", () => {
    const first = computeBidHash(bid, SECRET);
    const second = computeBidHash({ ...bid, prevHash: first, seq: 2, amountCents: 10_500n }, SECRET);

    const forgedFirst = computeBidHash({ ...bid, amountCents: 1n }, SECRET);
    const secondOverForged = computeBidHash(
      { ...bid, prevHash: forgedFirst, seq: 2, amountCents: 10_500n },
      SECRET,
    );
    expect(secondOverForged).not.toBe(second);
  });
});
