import { describe, expect, it } from "vitest";
import { checkLotForm } from "./auctioneer";
import { centsToInput, maskMoney, maskPastedMoney, MAX_MONEY_CENTS, parseMoneyToCents, parsePastedMoney } from "./money";
import { checkDeposit, MAX_DEPOSIT_CENTS } from "./wallet";

describe("maskMoney (digitar)", () => {
  it("formata por centavos, como maquininha", () => {
    expect(maskMoney("1")).toBe("0,01");
    expect(maskMoney("12")).toBe("0,12");
    expect(maskMoney("100")).toBe("1,00");
    expect(maskMoney("100000")).toBe("1.000,00");
    expect(maskMoney("123456789")).toBe("1.234.567,89");
  });

  it("acompanha a digitação dígito a dígito", () => {
    let text = "";
    const seen: string[] = [];
    for (const key of "129500") {
      text = maskMoney(text + key);
      seen.push(text);
    }
    expect(seen).toEqual(["0,01", "0,12", "1,29", "12,95", "129,50", "1.295,00"]);
  });

  it("backspace tira o último dígito", () => {
    expect(maskMoney("12.950,0")).toBe("1.295,00");
    expect(maskMoney("0,0")).toBe("");
    expect(maskMoney("0,01".slice(0, -1))).toBe("");
  });

  it("ignora letras e símbolos", () => {
    expect(maskMoney("a1b2c")).toBe("0,12");
    expect(maskMoney("US$ 1.234,56")).toBe("1.234,56");
    expect(maskMoney("abc")).toBe("");
    expect(maskMoney("")).toBe("");
  });

  it("zero e zeros à esquerda não aparecem", () => {
    expect(maskMoney("0")).toBe("");
    expect(maskMoney("000")).toBe("");
    expect(maskMoney("0,00")).toBe("");
    expect(maskMoney("0001")).toBe("0,01");
  });

  it("nunca passa do teto nem quebra com muitos dígitos", () => {
    expect(maskMoney("100000000000")).toBe(centsToInput(MAX_MONEY_CENTS));
    expect(maskMoney("999999999999")).toBe(centsToInput(MAX_MONEY_CENTS));
    expect(parseMoneyToCents(maskMoney("9".repeat(40)))).toBe(MAX_MONEY_CENTS);
  });

  it("é idempotente: aplicar de novo não muda o texto", () => {
    for (const text of ["1", "100", "123456", "0,05", "1.000,00", ""]) {
      const once = maskMoney(text);
      expect(maskMoney(once)).toBe(once);
    }
  });

  it("a saída é sempre um valor que o parser aceita (o erro de formato não existe mais)", () => {
    // Sequência pseudoaleatória fixa, para o teste ser reproduzível.
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let i = 0; i < 500; i += 1) {
      const length = (next() % 12) + 1;
      let digits = "";
      for (let j = 0; j < length; j += 1) digits += String(next() % 10);
      const masked = maskMoney(digits);
      if (masked === "") {
        expect(Number(digits)).toBe(0);
      } else {
        expect(parseMoneyToCents(masked)).toBe(Math.min(Number(digits), MAX_MONEY_CENTS));
      }
    }
  });
});

describe("parsePastedMoney / maskPastedMoney (colar)", () => {
  it("entende os formatos que as pessoas copiam", () => {
    expect(parsePastedMoney("1.000,00")).toBe(100_000);
    expect(parsePastedMoney("1,000.00")).toBe(100_000);
    expect(parsePastedMoney("US$ 1,234.56")).toBe(123_456);
    expect(parsePastedMoney("1,000")).toBe(100_000);
    expect(parsePastedMoney("1000")).toBe(100_000);
    expect(parsePastedMoney("1000.5")).toBe(100_050);
    expect(parsePastedMoney("1,5")).toBe(150);
  });

  it("devolve null para o que não é valor", () => {
    expect(parsePastedMoney("abc")).toBeNull();
    expect(parsePastedMoney("")).toBeNull();
    expect(parsePastedMoney("0")).toBeNull();
    expect(parsePastedMoney("1,000.000")).toBeNull();
  });

  it("cola 1000 como mil dólares (não como 10 centavos)", () => {
    expect(maskPastedMoney("1000")).toBe("1.000,00");
    expect(maskPastedMoney("1,000.00")).toBe("1.000,00");
    expect(maskPastedMoney("1.000,00")).toBe("1.000,00");
  });

  it("formato desconhecido cai na regra de digitar (só os dígitos)", () => {
    expect(maskPastedMoney("R$ 1.234,56")).toBe("1.234,56");
    expect(maskPastedMoney("abc")).toBe("");
    expect(maskPastedMoney("0")).toBe("");
  });
});

describe("a máscara com os validadores existentes", () => {
  it("depósito: o texto mascarado passa; o teto continua valendo", () => {
    expect(checkDeposit(maskMoney("100000"))).toEqual({ ok: true, cents: 100_000 });
    expect(checkDeposit(maskMoney(String(MAX_DEPOSIT_CENTS)))).toEqual({ ok: true, cents: MAX_DEPOSIT_CENTS });
    expect(checkDeposit(maskMoney(String(MAX_DEPOSIT_CENTS + 1)))).toMatchObject({ ok: false });
  });

  it("depósito: campo apagado dá a mensagem de valor, não um erro de formato", () => {
    expect(checkDeposit(maskMoney(""))).toMatchObject({ ok: false, error: expect.stringContaining("valor") });
  });

  it("novo lote: lance inicial e incremento mascarados geram os centavos certos", () => {
    const check = checkLotForm(
      { startingBid: maskMoney("400000"), minIncrement: maskMoney("50000"), startsAt: "2026-10-30T10:00", endsAt: "2026-10-30T12:00" },
      Date.parse("2026-10-29T10:00"),
    );
    expect(check).toMatchObject({ ok: true, payload: { startingBidCents: 400_000, minIncrementCents: 50_000 } });
  });

  it("novo lote: campos apagados continuam sendo recusados", () => {
    const check = checkLotForm(
      { startingBid: maskMoney(""), minIncrement: maskMoney("0"), startsAt: "2026-10-30T10:00", endsAt: "2026-10-30T12:00" },
      Date.parse("2026-10-29T10:00"),
    );
    expect(check).toMatchObject({ ok: false, errors: { startingBid: expect.any(String), minIncrement: expect.any(String) } });
  });
});
