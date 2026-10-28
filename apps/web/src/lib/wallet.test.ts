import { describe, expect, it } from "vitest";
import type { WalletBid, WalletEntry } from "../api/wallet";
import { addToAmount, bidStatusLabel, buildStatement, checkDeposit, entryLabel, formatSigned, MAX_DEPOSIT_CENTS } from "./wallet";

describe("checkDeposit", () => {
  it("accepts a valid amount in cents", () => {
    expect(checkDeposit("1.000,00")).toEqual({ ok: true, cents: 100_000 });
  });

  it("accepts exactly the ceiling and rejects one cent above it", () => {
    expect(checkDeposit("1.000.000,00")).toEqual({ ok: true, cents: MAX_DEPOSIT_CENTS });
    expect(checkDeposit("1.000.000,01")).toMatchObject({ ok: false });
  });

  it.each(["", "abc", "0", "-10"])("rejects %j as invalid", (text) => {
    expect(checkDeposit(text)).toMatchObject({ ok: false });
  });
});

describe("addToAmount", () => {
  it("adds to the current field value", () => {
    expect(addToAmount("1.000,00", 50_000)).toBe("1.500,00");
  });

  it("treats an empty or invalid field as zero", () => {
    expect(addToAmount("", 500_000)).toBe("5.000,00");
    expect(addToAmount("xyz", 100_000)).toBe("1.000,00");
  });

  it("never exceeds the deposit ceiling", () => {
    expect(addToAmount("999.999,00", 500_000)).toBe("1.000.000,00");
  });
});

describe("entry formatting", () => {
  it("labels every ledger kind in Portuguese", () => {
    expect(entryLabel("deposit")).toBe("Depósito simulado");
    expect(entryLabel("settlement_debit")).toBe("Débito de arremate");
    expect(entryLabel("settlement_credit")).toBe("Crédito de venda");
    expect(entryLabel("refund")).toBe("Estorno");
  });

  it("formats signed amounts", () => {
    expect(formatSigned(500_000)).toBe("+ US$ 5.000,00");
    expect(formatSigned(-115_000)).toBe("− US$ 1.150,00");
  });
});

const entry = (id: string, createdAt: string, kind: WalletEntry["kind"] = "deposit", amountCents = 100_000): WalletEntry => ({
  id,
  kind,
  amountCents,
  lotId: null,
  createdAt,
});
const bidRow = (id: string, placedAt: string, status: WalletBid["status"] = "leading"): WalletBid => ({
  id,
  lotId: "lot-1",
  lotTitle: "Vale of Kashmir",
  amountCents: 10_000,
  placedAt,
  status,
});

describe("buildStatement", () => {
  it("mixes ledger entries and bids, newest first", () => {
    const rows = buildStatement(
      [entry("d1", "2026-10-28T10:00:00.000Z"), entry("d2", "2026-10-28T12:00:00.000Z")],
      [bidRow("b1", "2026-10-28T11:00:00.000Z"), bidRow("b2", "2026-10-28T13:00:00.000Z")],
    );
    expect(rows.map((row) => row.key)).toEqual(["bid-b2", "entry-d2", "bid-b1", "entry-d1"]);
  });

  it("puts the ledger entry first when both share the same instant", () => {
    const at = "2026-10-28T10:00:00.000Z";
    const rows = buildStatement([entry("d1", at, "settlement_debit")], [bidRow("b1", at, "won")]);
    expect(rows.map((row) => row.type)).toEqual(["entry", "bid"]);
  });

  it("never mixes the two kinds up: bids keep their own data, entries keep the ledger amount", () => {
    const [first, second] = buildStatement([entry("d1", "2026-10-28T10:00:00.000Z", "settlement_debit", -10_000)], [
      bidRow("b1", "2026-10-28T11:00:00.000Z", "won"),
    ]);
    expect(first).toMatchObject({ type: "bid", bid: { status: "won", amountCents: 10_000 } });
    expect(second).toMatchObject({ type: "entry", entry: { kind: "settlement_debit", amountCents: -10_000 } });
  });

  it("keeps only the most recent rows up to the limit", () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry(`d${i}`, `2026-10-01T10:${String(i).padStart(2, "0")}:00.000Z`));
    const bids = Array.from({ length: 30 }, (_, i) => bidRow(`b${i}`, `2026-10-02T10:${String(i).padStart(2, "0")}:00.000Z`));
    const rows = buildStatement(entries, bids, 40);
    expect(rows).toHaveLength(40);
    // Todos os 30 lances (dia 02) entram; dos lançamentos (dia 01) sobram os 10 mais novos.
    expect(rows.filter((row) => row.type === "bid")).toHaveLength(30);
    expect(rows.at(-1)).toMatchObject({ key: "entry-d20" });
  });

  it("works with no bids (auctioneer) or no entries", () => {
    expect(buildStatement([entry("d1", "2026-10-28T10:00:00.000Z")], [])).toHaveLength(1);
    expect(buildStatement([], [bidRow("b1", "2026-10-28T10:00:00.000Z")])).toHaveLength(1);
    expect(buildStatement([], [])).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const entries = [entry("d1", "2026-10-28T10:00:00.000Z"), entry("d2", "2026-10-28T12:00:00.000Z")];
    const copy = [...entries];
    buildStatement(entries, []);
    expect(entries).toEqual(copy);
  });
});

describe("bidStatusLabel", () => {
  it("labels every status so the reader knows the money is reserved, returned or charged", () => {
    expect(bidStatusLabel("leading")).toContain("reservado");
    expect(bidStatusLabel("outbid")).toContain("devolvido");
    expect(bidStatusLabel("won")).toContain("Arrematado");
  });
});
