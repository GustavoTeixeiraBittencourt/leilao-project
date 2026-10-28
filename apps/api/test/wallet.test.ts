import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { settleLot } from "../src/modules/settlement/service.js";
import { authHeader, createLotRow, createUser, fund, tokenFor } from "./helpers.js";

describe("wallet", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("starts empty and reflects deposits as total and available", async () => {
    const bidder = await createUser("bidder");
    const headers = authHeader(tokenFor(app, bidder));

    const empty = await app.inject({ method: "GET", url: "/wallet", headers });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ totalCents: 0, committedCents: 0, availableCents: 0, entries: [] });

    const first = await app.inject({ method: "POST", url: "/wallet/deposit", headers, payload: { amountCents: 50_000 } });
    expect(first.statusCode).toBe(201);
    await app.inject({ method: "POST", url: "/wallet/deposit", headers, payload: { amountCents: 25_000 } });

    const wallet = await app.inject({ method: "GET", url: "/wallet", headers });
    const body = wallet.json();
    expect(body).toMatchObject({ totalCents: 75_000, committedCents: 0, availableCents: 75_000 });
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].kind).toBe("deposit");
    expect(new Date(body.serverNow).getTime()).not.toBeNaN();
  });

  it("rejects non-positive, fractional and oversized deposits", async () => {
    const bidder = await createUser("bidder");
    const headers = authHeader(tokenFor(app, bidder));

    for (const amountCents of [0, -100, 10.5, 100_000_001]) {
      const response = await app.inject({ method: "POST", url: "/wallet/deposit", headers, payload: { amountCents } });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_ERROR");
    }
  });

  it("does not let an auctioneer deposit", async () => {
    const auctioneer = await createUser("auctioneer");
    const response = await app.inject({
      method: "POST",
      url: "/wallet/deposit",
      headers: authHeader(tokenFor(app, auctioneer)),
      payload: { amountCents: 1000 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("FORBIDDEN");
  });

  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/wallet" });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("UNAUTHORIZED");
  });

  describe("bid activity in the statement", () => {
    async function setup() {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, title: "Vale of Kashmir" });
      const first = await createUser("bidder");
      const second = await createUser("bidder");
      await fund(first.id, 100_000);
      await fund(second.id, 100_000);
      return { lot, first, second, firstHeaders: authHeader(tokenFor(app, first)), secondHeaders: authHeader(tokenFor(app, second)) };
    }

    const bid = (headers: Record<string, string>, lotId: string, amountCents: number) =>
      app.inject({ method: "POST", url: `/lots/${lotId}/bids`, headers, payload: { amountCents } });
    const walletOf = async (headers: Record<string, string>) =>
      (await app.inject({ method: "GET", url: "/wallet", headers })).json();

    it("lists my bid with the lot title and status leading, without touching the ledger", async () => {
      const { lot, firstHeaders } = await setup();
      await bid(firstHeaders, lot.id, 10_000);

      const wallet = await walletOf(firstHeaders);

      expect(wallet.bids).toEqual([
        expect.objectContaining({ lotId: lot.id, lotTitle: "Vale of Kashmir", amountCents: 10_000, status: "leading" }),
      ]);
      // Lance só reserva: o ledger continua com o depósito e o total não muda.
      expect(wallet.entries).toHaveLength(1);
      expect(wallet).toMatchObject({ totalCents: 100_000, committedCents: 10_000, availableCents: 90_000 });
    });

    it("turns into outbid when someone covers it, and the value goes back to available", async () => {
      const { lot, firstHeaders, secondHeaders } = await setup();
      await bid(firstHeaders, lot.id, 10_000);
      await bid(secondHeaders, lot.id, 12_000);

      const mine = await walletOf(firstHeaders);
      const theirs = await walletOf(secondHeaders);

      expect(mine.bids[0]).toMatchObject({ amountCents: 10_000, status: "outbid" });
      expect(mine).toMatchObject({ committedCents: 0, availableCents: 100_000 });
      expect(theirs.bids[0]).toMatchObject({ amountCents: 12_000, status: "leading" });
    });

    it("keeps every bid of the same lot, newest first, and only the last one is leading", async () => {
      const { lot, firstHeaders, secondHeaders } = await setup();
      await bid(firstHeaders, lot.id, 10_000);
      await bid(secondHeaders, lot.id, 12_000);
      await bid(firstHeaders, lot.id, 14_000);

      const mine = await walletOf(firstHeaders);

      expect(mine.bids.map((b: { amountCents: number; status: string }) => [b.amountCents, b.status])).toEqual([
        [14_000, "leading"],
        [10_000, "outbid"],
      ]);
    });

    it("becomes won after the lot closes, next to the settlement debit", async () => {
      const { lot, firstHeaders } = await setup();
      await bid(firstHeaders, lot.id, 10_000);
      await prisma.lot.update({ where: { id: lot.id }, data: { endsAt: new Date(Date.now() - 1_000) } });
      await settleLot(lot.id);

      const wallet = await walletOf(firstHeaders);

      expect(wallet.bids[0]).toMatchObject({ amountCents: 10_000, status: "won" });
      expect(wallet.entries.map((e: { kind: string }) => e.kind)).toContain("settlement_debit");
      expect(wallet).toMatchObject({ totalCents: 90_000, committedCents: 0 });
    });

    it("never shows other people's bids, and an auctioneer gets an empty list", async () => {
      const { lot, firstHeaders, secondHeaders } = await setup();
      await bid(firstHeaders, lot.id, 10_000);

      const other = await walletOf(secondHeaders);
      const auctioneer = await createUser("auctioneer");
      const seller = await walletOf(authHeader(tokenFor(app, auctioneer)));

      expect(other.bids).toEqual([]);
      expect(seller.bids).toEqual([]);
    });
  });
});
