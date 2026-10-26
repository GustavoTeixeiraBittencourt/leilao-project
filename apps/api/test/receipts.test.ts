import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { settleLot } from "../src/modules/settlement/service.js";
import { authHeader, createLotRow, createUser, fund, tokenFor } from "./helpers.js";

const HOUR = 3_600_000;

describe("receipts and personal views", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function bid(token: string, lotId: string, amountCents: number) {
    return app.inject({
      method: "POST",
      url: `/lots/${lotId}/bids`,
      headers: authHeader(token),
      payload: { amountCents },
    });
  }

  async function newBidder() {
    const user = await createUser("bidder");
    await fund(user.id, 1_000_000);
    return { user, token: tokenFor(app, user) };
  }

  // Lote vendido: o vencedor leva por `price`. Devolve tudo que os testes precisam.
  async function soldLot(auctioneerId: string, price = 20_000) {
    const lot = await createLotRow({ auctioneerId, startingBidCents: price });
    const winner = await newBidder();
    await bid(winner.token, lot.id, price);
    await prisma.lot.update({ where: { id: lot.id }, data: { endsAt: new Date(Date.now() - 1_000) } });
    await settleLot(lot.id);
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { lotId: lot.id } });
    return { lot, winner, receipt };
  }

  describe("GET /receipts/:token", () => {
    it("is public and returns the lot snapshot, price, seal and only the winner's alias", async () => {
      const auctioneer = await createUser("auctioneer");
      const { lot, winner, receipt } = await soldLot(auctioneer.id, 20_000);

      const response = await app.inject({ method: "GET", url: `/receipts/${receipt.publicToken}` });

      expect(response.statusCode).toBe(200);
      const body = response.json().receipt;
      expect(body).toMatchObject({
        token: receipt.publicToken,
        amountCents: 20_000,
        winnerAlias: winner.user.publicAlias,
        seal: { count: 1, hash: receipt.sealHash },
        lot: { id: lot.id, title: "Test lot", bidCount: 1 },
      });
      expect(response.body).not.toContain(winner.user.email);
      expect(response.body).not.toContain(winner.user.displayName);
      expect(response.body).not.toContain(auctioneer.email);
    });

    it("works with every outbound fetch failing (item data comes from the stored snapshot)", async () => {
      const auctioneer = await createUser("auctioneer");
      const { receipt } = await soldLot(auctioneer.id);
      const fetchMock = vi.fn(() => Promise.reject(new Error("external API is down")));
      vi.stubGlobal("fetch", fetchMock);
      try {
        const response = await app.inject({ method: "GET", url: `/receipts/${receipt.publicToken}` });
        expect(response.statusCode).toBe(200);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("returns 404 for an unknown token and 400 for a malformed one", async () => {
      const unknown = await app.inject({ method: "GET", url: "/receipts/aaaaaaaaaaaaaaaaaaaaaa" });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().code).toBe("NOT_FOUND");

      const malformed = await app.inject({ method: "GET", url: "/receipts/x" });
      expect(malformed.statusCode).toBe(400);
    });
  });

  describe("GET /me/wins", () => {
    it("lists only the bidder's own wins, with the receipt token", async () => {
      const auctioneer = await createUser("auctioneer");
      const mine = await soldLot(auctioneer.id, 20_000);
      await soldLot(auctioneer.id, 30_000); // outro vencedor

      const response = await app.inject({ method: "GET", url: "/me/wins", headers: authHeader(mine.winner.token) });

      expect(response.statusCode).toBe(200);
      const { wins } = response.json();
      expect(wins).toHaveLength(1);
      expect(wins[0]).toMatchObject({
        receiptToken: mine.receipt.publicToken,
        lotId: mine.lot.id,
        amountCents: 20_000,
      });
    });

    it("is bidder-only and requires authentication", async () => {
      const auctioneer = await createUser("auctioneer");

      const asAuctioneer = await app.inject({ method: "GET", url: "/me/wins", headers: authHeader(tokenFor(app, auctioneer)) });
      expect(asAuctioneer.statusCode).toBe(403);

      const anonymous = await app.inject({ method: "GET", url: "/me/wins" });
      expect(anonymous.statusCode).toBe(401);
    });
  });

  describe("GET /me/auctions", () => {
    it("shows sold and unsold results and the total actually received", async () => {
      const auctioneer = await createUser("auctioneer");
      const sold1 = await soldLot(auctioneer.id, 20_000);
      const sold2 = await soldLot(auctioneer.id, 35_000);
      const unsold = await createLotRow({ auctioneerId: auctioneer.id });
      await prisma.lot.update({ where: { id: unsold.id }, data: { endsAt: new Date(Date.now() - 1_000) } });
      await settleLot(unsold.id);
      const live = await createLotRow({ auctioneerId: auctioneer.id }); // ainda aberto, sem lances
      const other = await createUser("auctioneer");
      await soldLot(other.id, 99_000); // de outro leiloeiro: não aparece

      const response = await app.inject({ method: "GET", url: "/me/auctions", headers: authHeader(tokenFor(app, auctioneer)) });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.totalReceivedCents).toBe(55_000);
      expect(body.lots).toHaveLength(4); // só os dele: o lote do outro leiloeiro não entra
      const byLot = new Map(body.lots.map((row: { id: string }) => [row.id, row]));
      expect(byLot.get(sold1.lot.id)).toMatchObject({
        sold: true,
        phase: "ended",
        finalPriceCents: 20_000,
        winnerAlias: sold1.winner.user.publicAlias,
        canCancel: false,
      });
      expect(byLot.get(sold2.lot.id)).toMatchObject({ sold: true, finalPriceCents: 35_000 });
      expect(byLot.get(unsold.id)).toMatchObject({ sold: false, finalPriceCents: null, winnerAlias: null, bidCount: 0, canCancel: false });
      expect(byLot.get(live.id)).toMatchObject({ phase: "live", sold: false, canCancel: true });
      expect(response.body).not.toContain(sold1.winner.user.email);
    });

    it("lists cancelled and scheduled lots and says which ones can be cancelled", async () => {
      const auctioneer = await createUser("auctioneer");
      const scheduled = await createLotRow({ auctioneerId: auctioneer.id, startsInMs: HOUR, endsInMs: 2 * HOUR });
      const cancelled = await createLotRow({ auctioneerId: auctioneer.id });
      await prisma.lot.update({ where: { id: cancelled.id }, data: { status: "cancelled" } });
      const withBids = await createLotRow({ auctioneerId: auctioneer.id });
      const bidder = await newBidder();
      await bid(bidder.token, withBids.id, 10_000);

      const response = await app.inject({ method: "GET", url: "/me/auctions", headers: authHeader(tokenFor(app, auctioneer)) });

      const byLot = new Map(response.json().lots.map((row: { id: string }) => [row.id, row]));
      expect(byLot.get(scheduled.id)).toMatchObject({ phase: "scheduled", canCancel: true });
      expect(byLot.get(cancelled.id)).toMatchObject({ phase: "cancelled", status: "cancelled", canCancel: false });
      expect(byLot.get(withBids.id)).toMatchObject({ phase: "live", bidCount: 1, canCancel: false });
    });

    it("is auctioneer-only", async () => {
      const bidder = await newBidder();
      const response = await app.inject({ method: "GET", url: "/me/auctions", headers: authHeader(bidder.token) });
      expect(response.statusCode).toBe(403);
    });
  });
});
