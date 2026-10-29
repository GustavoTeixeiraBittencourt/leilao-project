import { describe, expect, it } from "vitest";
import { navItems } from "./nav";

const labels = (role: Parameters<typeof navItems>[0]) => navItems(role).map((item) => item.label);

describe("navItems", () => {
  it("gives the bidder wins and wallet", () => {
    expect(labels("bidder")).toEqual(["Vitrine", "Meus arremates", "Carteira", "Auditoria"]);
  });

  it("gives the auctioneer the dashboard and the new lot form, never the wallet", () => {
    expect(labels("auctioneer")).toEqual(["Vitrine", "Meus lotes", "Novo lote", "Auditoria"]);
  });

  it("keeps the public audit reachable for visitors", () => {
    expect(labels(null)).toEqual(["Vitrine", "Auditoria"]);
  });
});
