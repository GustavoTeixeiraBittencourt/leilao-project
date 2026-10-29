import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import {
  formatCountdown,
  formatCountdownShort,
  remainingMs,
  resetServerClock,
  serverNowMs,
  syncServerClock,
} from "./clock";
import { describeError, messageForCode } from "./errors";
import {
  bidsLabel,
  firstLine,
  formatDateTime,
  formatDayAt,
  formatDayMonth,
  formatFullDateTime,
  formatMoney,
  initial,
  lotCode,
} from "./format";

// Normaliza o espaço (o Intl pode usar NBSP) para comparar texto.
const text = (value: string) => value.replace(/ /g, " ");

describe("formatMoney", () => {
  it("formats integer cents as US$ with Brazilian separators", () => {
    expect(text(formatMoney(1_245_000))).toBe("US$ 12.450,00");
    expect(text(formatMoney(340_000))).toBe("US$ 3.400,00");
    expect(text(formatMoney(5))).toBe("US$ 0,05");
    expect(text(formatMoney(0))).toBe("US$ 0,00");
    expect(text(formatMoney(123_456_789))).toBe("US$ 1.234.567,89");
  });
});

describe("date formatting", () => {
  it("renders local day/month and time with zero padding", () => {
    const iso = new Date(2026, 9, 7, 8, 5).toISOString(); // 07/10/2026 08:05 no fuso local
    expect(formatDateTime(iso)).toBe("07/10 08:05");
    expect(formatFullDateTime(iso)).toBe("07/10/2026 08:05");
  });
});

describe("small helpers", () => {
  it("shortens a lot id and takes the first letter for the avatar", () => {
    expect(lotCode("af384ed7-fd13-412f-9b2c-000000000000")).toBe("AF384ED7");
    expect(initial("  gustavo")).toBe("G");
    expect(initial("")).toBe("?");
  });
});

describe("server clock", () => {
  beforeEach(() => resetServerClock());

  it("derives the offset from the server time and applies it to the client clock", () => {
    // O relógio do cliente está 5 min ATRASADO em relação ao servidor.
    const clientNow = Date.parse("2026-10-27T12:00:00.000Z");
    syncServerClock("2026-10-27T12:05:00.000Z", clientNow);

    expect(serverNowMs(clientNow)).toBe(Date.parse("2026-10-27T12:05:00.000Z"));
    expect(serverNowMs(clientNow + 1_000)).toBe(Date.parse("2026-10-27T12:05:01.000Z"));
  });

  it("computes the remaining time from the server clock, not the local one", () => {
    const clientNow = Date.parse("2026-10-27T12:00:00.000Z");
    syncServerClock("2026-10-27T12:05:00.000Z", clientNow); // servidor 5 min à frente

    // Fim às 12:10 do servidor: faltam 5 min, mesmo que o relógio local diga 12:00.
    expect(remainingMs("2026-10-27T12:10:00.000Z", clientNow)).toBe(5 * 60_000);
  });

  it("never goes negative once the lot has ended", () => {
    const clientNow = Date.parse("2026-10-27T12:00:00.000Z");
    syncServerClock("2026-10-27T12:00:00.000Z", clientNow);
    expect(remainingMs("2026-10-27T11:00:00.000Z", clientNow)).toBe(0);
  });

  it("ignores an invalid server time instead of corrupting the offset", () => {
    const clientNow = Date.parse("2026-10-27T12:00:00.000Z");
    syncServerClock("2026-10-27T12:05:00.000Z", clientNow);
    syncServerClock("not-a-date", clientNow);
    expect(serverNowMs(clientNow)).toBe(Date.parse("2026-10-27T12:05:00.000Z"));
  });

  it("starts with no offset", () => {
    const now = Date.now();
    expect(serverNowMs(now)).toBe(now);
  });
});

describe("formatCountdown", () => {
  it("formats hh:mm:ss and adds days when needed", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(9_000)).toBe("00:00:09");
    expect(formatCountdown((2 * 3600 + 14 * 60 + 9) * 1000)).toBe("02:14:09");
    expect(formatCountdown((26 * 3600 + 5) * 1000)).toBe("1d 02:00:05");
  });

  it("rounds down partial seconds and clamps negatives", () => {
    expect(formatCountdown(1_999)).toBe("00:00:01");
    expect(formatCountdown(-500)).toBe("00:00:00");
  });
});

describe("card labels", () => {
  it("uses the compact day+hour countdown beyond one day and the clock otherwise", () => {
    expect(formatCountdownShort((27 * 3600) * 1000)).toBe("1d 03h");
    expect(formatCountdownShort((3 * 86_400 + 5 * 3600) * 1000)).toBe("3d 05h");
    expect(formatCountdownShort(4 * 60_000 + 32_000)).toBe("00:04:32");
    expect(formatCountdownShort(0)).toBe("00:00:00");
  });

  it("formats opening dates and bid counts the way the cards show them", () => {
    const iso = new Date(2026, 9, 29, 14, 0).toISOString();
    expect(formatDayMonth(iso)).toBe("29/10");
    expect(formatDayAt(iso)).toBe("29/10 às 14:00");
    expect(bidsLabel(0)).toBe("Sem lances");
    expect(bidsLabel(1)).toBe("1 lance");
    expect(bidsLabel(23)).toBe("23 lances");
  });

  it("keeps only the first line of the artist text", () => {
    expect(firstLine("Georges Seurat (French, 1859–1891)\nExtra line")).toBe("Georges Seurat (French, 1859–1891)");
    expect(firstLine(null)).toBe("");
    expect(firstLine(undefined)).toBe("");
  });
});

describe("error messages", () => {
  it("has a Portuguese message for every stable API code", () => {
    const codes = [
      "BID_BELOW_MIN",
      "INSUFFICIENT_FUNDS",
      "ALREADY_LEADING",
      "LOT_NOT_STARTED",
      "LOT_CLOSED",
      "AUCTIONEER_CANNOT_BID",
      "LOT_HAS_BIDS",
      "LOT_NOT_CANCELLABLE",
      "LOT_NOT_EDITABLE",
      "INVALID_CREDENTIALS",
      "EMAIL_ALREADY_IN_USE",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "VALIDATION_ERROR",
      "NETWORK_ERROR",
      "INTERNAL_ERROR",
    ];
    const fallback = messageForCode("SOMETHING_NEW");
    for (const code of codes) {
      expect(messageForCode(code), code).not.toBe(fallback);
      expect(messageForCode(code)).toMatch(/[áéíóúãõçâê]|[A-Z]/); // texto humano, não o código
    }
  });

  it("describes an ApiError by its code and anything else with the generic fallback", () => {
    expect(describeError(new ApiError("INSUFFICIENT_FUNDS", "Insufficient funds", 422))).toBe(
      messageForCode("INSUFFICIENT_FUNDS"),
    );
    expect(describeError(new Error("boom"))).toBe(messageForCode("SOMETHING_NEW"));
    expect(describeError(undefined)).toBe(messageForCode("SOMETHING_NEW"));
  });
});
