import { describe, expect, it } from "vitest";
import type { MyLot } from "../api/auctioneer";
import { checkLotForm, computeKpis, defaultLotTimes, parseLocalInput, resultText, toLocalInput } from "./auctioneer";

function lot(overrides: Partial<MyLot> = {}): MyLot {
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
    sold: false,
    closedAt: null,
    canCancel: true,
    ...overrides,
  };
}

describe("computeKpis", () => {
  it("counts by phase and splits ended lots into sold / unsold, ignoring cancelled", () => {
    const kpis = computeKpis([
      lot({ phase: "live" }),
      lot({ phase: "scheduled" }),
      lot({ phase: "ended", sold: true }),
      lot({ phase: "ended", sold: false }),
      lot({ phase: "cancelled", status: "cancelled" }),
    ]);
    expect(kpis).toEqual({ live: 1, scheduled: 1, ended: 2, endedSold: 1, endedUnsold: 1 });
  });

  it("is all zeros for no lots", () => {
    expect(computeKpis([])).toEqual({ live: 0, scheduled: 0, ended: 0, endedSold: 0, endedUnsold: 0 });
  });
});

describe("resultText", () => {
  it("shows winner and amount received for a sold lot", () => {
    const text = resultText(lot({ phase: "ended", sold: true, winnerAlias: "Licitante #a3f9", finalPriceCents: 115_000 }));
    expect(text).toBe("Arrematado por Licitante #a3f9 · recebido US$ 1.150,00");
  });

  it("says there was no winner when an ended lot had no bids", () => {
    expect(resultText(lot({ phase: "ended" }))).toBe("Encerrado sem lances · sem vencedor");
  });

  it("explains why a lot with bids cannot be cancelled", () => {
    expect(resultText(lot({ bidCount: 23 }))).toBe("23 lances · não é possível editar nem cancelar");
    expect(resultText(lot({ bidCount: 1 }))).toContain("1 lance ·");
  });

  it("says a lot with no bids can be cancelled", () => {
    expect(resultText(lot({ phase: "scheduled" }))).toBe("Sem lances · pode ser editado ou cancelado");
  });

  it("says a cancelled lot is hidden from the showcase", () => {
    expect(resultText(lot({ phase: "cancelled", status: "cancelled" }))).toContain("não aparece na vitrine");
  });
});

describe("local datetime helpers", () => {
  it("round-trips a datetime-local value", () => {
    const ms = parseLocalInput("2026-10-29T14:00");
    expect(ms).not.toBeNull();
    expect(toLocalInput(ms as number)).toBe("2026-10-29T14:00");
  });

  it("rejects empty and malformed values", () => {
    expect(parseLocalInput("")).toBeNull();
    expect(parseLocalInput("29/10/2026 14:00")).toBeNull();
    expect(parseLocalInput("2026-13-45T99:99")).toBeNull();
  });

  it("suggests a start in 5 minutes lasting one hour", () => {
    const now = parseLocalInput("2026-10-29T14:00") as number;
    expect(defaultLotTimes(now)).toEqual({ startsAt: "2026-10-29T14:05", endsAt: "2026-10-29T15:05" });
  });
});

describe("checkLotForm", () => {
  const now = parseLocalInput("2026-10-29T12:00") as number;
  const valid = { startingBid: "4.000,00", minIncrement: "500,00", startsAt: "2026-10-29T14:00", endsAt: "2026-10-29T20:00" };

  it("builds the payload in integer cents and UTC ISO strings", () => {
    const result = checkLotForm(valid, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.startingBidCents).toBe(400_000);
      expect(result.payload.minIncrementCents).toBe(50_000);
      expect(result.payload.startsAt).toBe(new Date("2026-10-29T14:00").toISOString());
      expect(result.payload.endsAt).toBe(new Date("2026-10-29T20:00").toISOString());
    }
  });

  it("rejects non-positive or malformed money", () => {
    const result = checkLotForm({ ...valid, startingBid: "0", minIncrement: "abc" }, now);
    expect(result).toMatchObject({ ok: false, errors: { startingBid: expect.any(String), minIncrement: expect.any(String) } });
  });

  it("requires the end to be after the server's now", () => {
    const result = checkLotForm({ ...valid, startsAt: "2026-10-29T08:00", endsAt: "2026-10-29T11:00" }, now);
    expect(result).toMatchObject({ ok: false, errors: { endsAt: "O encerramento precisa estar no futuro." } });
  });

  it("requires the end to be after the start", () => {
    const result = checkLotForm({ ...valid, startsAt: "2026-10-29T20:00", endsAt: "2026-10-29T14:00" }, now);
    expect(result).toMatchObject({ ok: false, errors: { endsAt: "O encerramento precisa ser depois do início." } });
  });

  it("allows a start in the past (the lot simply opens right away)", () => {
    expect(checkLotForm({ ...valid, startsAt: "2026-10-29T08:00" }, now).ok).toBe(true);
  });

  it("reports missing dates", () => {
    const result = checkLotForm({ ...valid, startsAt: "", endsAt: "" }, now);
    expect(result).toMatchObject({ ok: false, errors: { startsAt: expect.any(String), endsAt: expect.any(String) } });
  });
});
