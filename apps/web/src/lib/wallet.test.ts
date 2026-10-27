import { describe, expect, it } from "vitest";
import { addToAmount, checkDeposit, entryLabel, formatSigned, MAX_DEPOSIT_CENTS } from "./wallet";

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
