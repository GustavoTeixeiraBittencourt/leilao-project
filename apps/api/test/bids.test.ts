import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { computeBidHash, genesisHash } from "../src/lib/hash-chain.js";
import { getBalance } from "../src/modules/wallet/service.js";
import { authHeader, createLotRow, createUser, fund, tokenFor } from "./helpers.js";

const MINUTE = 60_000;

describe("bids", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function newBidder(fundsCents = 1_000_000) {
    const user = await createUser("bidder");
    if (fundsCents > 0) await fund(user.id, fundsCents);
    return { user, token: tokenFor(app, user) };
  }

  function bid(token: string, lotId: string, amountCents: number) {
    return app.inject({
      method: "POST",
      url: `/lots/${lotId}/bids`,
      headers: authHeader(token),
      payload: { amountCents },
    });
  }

  // Recalcula a cadeia inteira a partir do banco, como a auditoria da Etapa 3
  // fará: genesis -> lance 1 -> ... -> lance N. Retorna true se tudo confere.
  async function chainIsValid(lotId: string) {
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    const bids = await prisma.bid.findMany({
      where: { lotId },
      orderBy: { seq: "asc" },
      include: { bidder: { select: { publicAlias: true } } },
    });
    let prev = genesisHash({
      lotId,
      auctioneerId: lot.auctioneerId,
      startingBidCents: lot.startingBidCents,
      minIncrementCents: lot.minIncrementCents,
      startsAt: lot.startsAt,
    });
    for (const [index, row] of bids.entries()) {
      if (row.seq !== index + 1 || row.prevHash !== prev) return false;
      const expected = computeBidHash({
        prevHash: prev,
        lotId,
        seq: row.seq,
        alias: row.bidder.publicAlias,
        amountCents: row.amountCents,
        placedAt: row.placedAt,
      });
      if (row.hash !== expected) return false;
      prev = row.hash;
    }
    return true;
  }

  describe("acceptance", () => {
    it("accepts the first bid at the starting price and updates the lot", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 10_000 });
      const { user, token } = await newBidder(50_000);

      const response = await bid(token, lot.id, 10_000);

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.bid.seq).toBe(1);
      expect(body.lot).toMatchObject({ currentBidCents: 10_000, bidCount: 1, leaderAlias: user.publicAlias });
      expect(body.wallet).toMatchObject({ totalCents: 50_000, committedCents: 10_000, availableCents: 40_000 });
      expect(body.extended).toBe(false);
      expect(await chainIsValid(lot.id)).toBe(true);
    });

    it("requires current + increment for following bids, accepting exactly that", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 10_000, minIncrementCents: 1_000 });
      const a = await newBidder();
      const b = await newBidder();

      expect((await bid(a.token, lot.id, 10_000)).statusCode).toBe(201);
      expect((await bid(b.token, lot.id, 10_999)).json().code).toBe("BID_BELOW_MIN");
      expect((await bid(b.token, lot.id, 11_000)).statusCode).toBe(201);
      expect(await chainIsValid(lot.id)).toBe(true);
    });

    it("lists the public history with aliases only", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const a = await newBidder();
      const b = await newBidder();
      await bid(a.token, lot.id, 10_000);
      await bid(b.token, lot.id, 11_000);

      const response = await app.inject({ method: "GET", url: `/lots/${lot.id}/bids` });

      expect(response.statusCode).toBe(200);
      const { bids } = response.json();
      expect(bids.map((row: { seq: number }) => row.seq)).toEqual([2, 1]);
      expect(bids[0].bidderAlias).toBe(b.user.publicAlias);
      expect(response.body).not.toContain(a.user.email);
      expect(response.body).not.toContain(b.user.email);
    });
  });

  describe("refusals", () => {
    it("BID_BELOW_MIN: first bid under the starting price", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 10_000 });
      const { token } = await newBidder();

      const response = await bid(token, lot.id, 9_999);

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("BID_BELOW_MIN");
    });

    it("INSUFFICIENT_FUNDS: amount above the available balance", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 10_000 });
      const { token } = await newBidder(9_999);

      const response = await bid(token, lot.id, 10_000);

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("INSUFFICIENT_FUNDS");
    });

    it("ALREADY_LEADING: the leader cannot outbid themselves", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const { token } = await newBidder();
      await bid(token, lot.id, 10_000);

      const response = await bid(token, lot.id, 50_000);

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("ALREADY_LEADING");
    });

    it("LOT_NOT_STARTED: lot scheduled for the future", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startsInMs: 10 * MINUTE, endsInMs: 60 * MINUTE });
      const { token } = await newBidder();

      const response = await bid(token, lot.id, 10_000);

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("LOT_NOT_STARTED");
    });

    it("LOT_CLOSED: ended, closed and cancelled lots", async () => {
      const auctioneer = await createUser("auctioneer");
      const { token } = await newBidder();
      const overdue = await createLotRow({ auctioneerId: auctioneer.id, startsInMs: -60 * MINUTE, endsInMs: -1_000 });
      const closed = await createLotRow({ auctioneerId: auctioneer.id });
      const cancelled = await createLotRow({ auctioneerId: auctioneer.id });
      await prisma.lot.update({ where: { id: closed.id }, data: { status: "closed" } });
      await prisma.lot.update({ where: { id: cancelled.id }, data: { status: "cancelled" } });

      for (const lot of [overdue, closed, cancelled]) {
        const response = await bid(token, lot.id, 10_000);
        expect(response.statusCode).toBe(422);
        expect(response.json().code).toBe("LOT_CLOSED");
      }
    });

    it("AUCTIONEER_CANNOT_BID: blocked on the backend, even on their own lot", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });

      const response = await bid(tokenFor(app, auctioneer), lot.id, 10_000);

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe("AUCTIONEER_CANNOT_BID");
    });

    it("revalidates the role against the database, not the token", async () => {
      // JWT diz "bidder", mas o usuário no banco é leiloeiro: o banco manda.
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const forgedToken = app.jwt.sign({ sub: auctioneer.id, role: "bidder" });

      const response = await bid(forgedToken, lot.id, 10_000);

      expect(response.json().code).toBe("AUCTIONEER_CANNOT_BID");
    });

    it("requires authentication and a known lot", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const { token } = await newBidder();

      const anonymous = await app.inject({ method: "POST", url: `/lots/${lot.id}/bids`, payload: { amountCents: 10_000 } });
      expect(anonymous.statusCode).toBe(401);

      const unknown = await bid(token, "00000000-0000-4000-8000-000000000000", 10_000);
      expect(unknown.statusCode).toBe(404);
    });

    it("a refused bid leaves no trace", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 10_000 });
      const { token } = await newBidder();

      await bid(token, lot.id, 1);

      const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(stored.bidCount).toBe(0);
      expect(stored.leaderId).toBeNull();
      expect(stored.currentBidCents).toBeNull();
      expect(await prisma.bid.count({ where: { lotId: lot.id } })).toBe(0);
    });
  });

  describe("committed balance", () => {
    it("locks the leader's amount and releases it as soon as they are outbid", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 20_000, minIncrementCents: 1_000 });
      const a = await newBidder(30_000);
      const b = await newBidder(30_000);

      await bid(a.token, lot.id, 20_000);
      expect(await getBalance(prisma, a.user.id)).toMatchObject({ committedCents: 20_000n, availableCents: 10_000n });

      await bid(b.token, lot.id, 21_000);

      expect(await getBalance(prisma, a.user.id)).toMatchObject({ committedCents: 0n, availableCents: 30_000n });
      expect(await getBalance(prisma, b.user.id)).toMatchObject({ committedCents: 21_000n, availableCents: 9_000n });
    });

    it("counts what the bidder already leads in OTHER lots", async () => {
      const auctioneer = await createUser("auctioneer");
      const first = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 20_000 });
      const second = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 15_000 });
      const { token } = await newBidder(30_000);

      expect((await bid(token, first.id, 20_000)).statusCode).toBe(201);
      const response = await bid(token, second.id, 15_000);

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("INSUFFICIENT_FUNDS");
    });
  });

  describe("anti-sniping", () => {
    it("extends to now + 2 min when a bid lands in the last 2 minutes", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startsInMs: -60 * MINUTE, endsInMs: 30_000 });
      const { token } = await newBidder();

      const response = await bid(token, lot.id, 10_000);

      expect(response.statusCode).toBe(201);
      expect(response.json().extended).toBe(true);
      const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
      const placed = await prisma.bid.findFirstOrThrow({ where: { lotId: lot.id } });
      expect(stored.endsAt.getTime()).toBe(placed.placedAt.getTime() + 2 * MINUTE);
    });

    it("never shortens a lot and leaves it alone when more than 2 minutes remain", async () => {
      const auctioneer = await createUser("auctioneer");
      const far = await createLotRow({ auctioneerId: auctioneer.id, endsInMs: 60 * MINUTE });
      const near = await createLotRow({ auctioneerId: auctioneer.id, endsInMs: 3 * MINUTE });
      const { token } = await newBidder();

      const farResponse = await bid(token, far.id, 10_000);
      const nearResponse = await bid(token, near.id, 10_000);

      expect(farResponse.json().extended).toBe(false);
      expect(nearResponse.json().extended).toBe(false);
      expect((await prisma.lot.findUniqueOrThrow({ where: { id: far.id } })).endsAt).toEqual(far.endsAt);
      expect((await prisma.lot.findUniqueOrThrow({ where: { id: near.id } })).endsAt).toEqual(near.endsAt);
    });
  });

  describe("concurrency", () => {
    it("serializes simultaneous equal bids: exactly one wins, the rest are below minimum", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 10_000, minIncrementCents: 1_000 });
      const bidders = await Promise.all(Array.from({ length: 15 }, () => newBidder()));

      const responses = await Promise.all(bidders.map(({ token }) => bid(token, lot.id, 10_000)));

      const accepted = responses.filter((response) => response.statusCode === 201);
      const refused = responses.filter((response) => response.statusCode !== 201);
      expect(accepted).toHaveLength(1);
      expect(refused.every((response) => response.json().code === "BID_BELOW_MIN")).toBe(true);

      const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(stored.bidCount).toBe(1);
      expect(await chainIsValid(lot.id)).toBe(true);
    });

    it("keeps seq contiguous, amounts rising and the hash chain valid under a bid storm", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 10_000, minIncrementCents: 1_000 });
      const bidders = await Promise.all(Array.from({ length: 20 }, () => newBidder()));

      // Cada um oferta um valor distinto; a ordem de chegada ao lock é imprevisível.
      const responses = await Promise.all(
        bidders.map(({ token }, index) => bid(token, lot.id, 10_000 + index * 1_000)),
      );

      const accepted = responses.filter((response) => response.statusCode === 201).length;
      expect(accepted).toBeGreaterThan(0);
      expect(
        responses
          .filter((response) => response.statusCode !== 201)
          .every((response) => response.json().code === "BID_BELOW_MIN"),
      ).toBe(true);

      const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
      const rows = await prisma.bid.findMany({ where: { lotId: lot.id }, orderBy: { seq: "asc" } });
      expect(rows.map((row) => row.seq)).toEqual(Array.from({ length: accepted }, (_, i) => i + 1));
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]!.amountCents - rows[i - 1]!.amountCents).toBeGreaterThanOrEqual(1_000n);
      }
      expect(stored.bidCount).toBe(accepted);
      expect(stored.currentBidCents).toBe(rows.at(-1)!.amountCents);
      expect(stored.leaderId).toBe(rows.at(-1)!.bidderId);
      expect(await chainIsValid(lot.id)).toBe(true);
    });

    it("never lets one bidder commit more than their balance across lots at the same time", async () => {
      const auctioneer = await createUser("auctioneer");
      const lots = await Promise.all(
        Array.from({ length: 5 }, () => createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 10_000 })),
      );
      // Saldo para um lance só (10.000), mas 5 lances simultâneos em lotes diferentes.
      const { user, token } = await newBidder(15_000);

      const responses = await Promise.all(lots.map((lot) => bid(token, lot.id, 10_000)));

      const accepted = responses.filter((response) => response.statusCode === 201);
      const refused = responses.filter((response) => response.statusCode !== 201);
      expect(accepted).toHaveLength(1);
      expect(refused.every((response) => response.json().code === "INSUFFICIENT_FUNDS")).toBe(true);

      const balance = await getBalance(prisma, user.id);
      expect(balance.committedCents).toBe(10_000n);
      expect(balance.availableCents).toBe(5_000n);
    });
  });
});
