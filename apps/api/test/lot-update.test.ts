import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { authHeader, createLotRow, createUser, fund, tokenFor } from "./helpers.js";

const HOUR = 3_600_000;

describe("PATCH /lots/:id", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function patch(token: string | null, lotId: string, payload: unknown) {
    return app.inject({
      method: "PATCH",
      url: `/lots/${lotId}`,
      headers: token ? authHeader(token) : {},
      payload: payload as Record<string, unknown>,
    });
  }

  async function auctioneerWithLot(options: Parameters<typeof createLotRow>[0] extends infer O ? Partial<O> : never = {}) {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id, ...options });
    return { auctioneer, lot, token: tokenFor(app, auctioneer) };
  }

  it("updates the auction parameters of a scheduled lot without bids", async () => {
    const { lot, token } = await auctioneerWithLot({ startsInMs: HOUR, endsInMs: 2 * HOUR });
    const startsAt = new Date(Date.now() + 2 * HOUR).toISOString();
    const endsAt = new Date(Date.now() + 5 * HOUR).toISOString();

    const response = await patch(token, lot.id, {
      startingBidCents: 700_000,
      minIncrementCents: 25_000,
      startsAt,
      endsAt,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lot.startingBidCents).toBe(700_000);
    expect(body.lot.minIncrementCents).toBe(25_000);
    expect(body.lot.startsAt).toBe(startsAt);
    expect(body.lot.endsAt).toBe(endsAt);
    expect(body.lot.phase).toBe("scheduled");
  });

  it("accepts a partial update and keeps the other fields", async () => {
    const { lot, token } = await auctioneerWithLot({ startsInMs: HOUR, endsInMs: 2 * HOUR });
    const before = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });

    const response = await patch(token, lot.id, { minIncrementCents: 12_345 });

    expect(response.statusCode).toBe(200);
    const after = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(after.minIncrementCents).toBe(12_345n);
    expect(after.startingBidCents).toBe(before.startingBidCents);
    expect(after.startsAt).toEqual(before.startsAt);
    expect(after.endsAt).toEqual(before.endsAt);
  });

  it("lets a live lot change the end and the price, but not the start", async () => {
    const { lot, token } = await auctioneerWithLot({ startsInMs: -HOUR, endsInMs: HOUR });

    const ok = await patch(token, lot.id, { startingBidCents: 900_000, endsAt: new Date(Date.now() + 3 * HOUR).toISOString() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().lot.phase).toBe("live");

    const moveStart = await patch(token, lot.id, { startsAt: new Date(Date.now() + HOUR).toISOString() });
    expect(moveStart.statusCode).toBe(400);
    expect(moveStart.json().code).toBe("VALIDATION_ERROR");
  });

  it("rejects an end that is not after the start, or not in the future", async () => {
    const { lot, token } = await auctioneerWithLot({ startsInMs: HOUR, endsInMs: 2 * HOUR });

    const beforeStart = await patch(token, lot.id, { endsAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    expect(beforeStart.statusCode).toBe(400);

    const past = await patch(token, lot.id, {
      startsAt: new Date(Date.now() - 3 * HOUR).toISOString(),
      endsAt: new Date(Date.now() - HOUR).toISOString(),
    });
    expect(past.statusCode).toBe(400);
  });

  it("validates the body: empty, non-positive and float values", async () => {
    const { lot, token } = await auctioneerWithLot({ startsInMs: HOUR, endsInMs: 2 * HOUR });

    expect((await patch(token, lot.id, {})).statusCode).toBe(400);
    expect((await patch(token, lot.id, { startingBidCents: 0 })).statusCode).toBe(400);
    expect((await patch(token, lot.id, { minIncrementCents: 10.5 })).statusCode).toBe(400);
  });

  it("LOT_NOT_EDITABLE once the lot has a bid", async () => {
    const { lot, token } = await auctioneerWithLot({ startsInMs: -HOUR, endsInMs: HOUR });
    const bidder = await createUser("bidder");
    await fund(bidder.id, 10_000_000);
    const placed = await app.inject({
      method: "POST",
      url: `/lots/${lot.id}/bids`,
      headers: authHeader(tokenFor(app, bidder)),
      payload: { amountCents: 1_000_000 },
    });
    expect(placed.statusCode).toBe(201);

    const response = await patch(token, lot.id, { startingBidCents: 1 });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("LOT_NOT_EDITABLE");
    const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(stored.startingBidCents).not.toBe(1n);
  });

  it("LOT_NOT_EDITABLE for ended and cancelled lots", async () => {
    const ended = await auctioneerWithLot({ startsInMs: -2 * HOUR, endsInMs: -HOUR });
    const cancelled = await auctioneerWithLot({ startsInMs: HOUR, endsInMs: 2 * HOUR });
    await prisma.lot.update({ where: { id: cancelled.lot.id }, data: { status: "cancelled" } });

    for (const { lot, token } of [ended, cancelled]) {
      const response = await patch(token, lot.id, { minIncrementCents: 100 });
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe("LOT_NOT_EDITABLE");
    }
  });

  it("403 for another auctioneer and for a bidder, 401 anonymous, 404 unknown lot", async () => {
    const { lot } = await auctioneerWithLot({ startsInMs: HOUR, endsInMs: 2 * HOUR });
    const other = await createUser("auctioneer");
    const bidder = await createUser("bidder");

    expect((await patch(tokenFor(app, other), lot.id, { minIncrementCents: 100 })).statusCode).toBe(403);
    expect((await patch(tokenFor(app, bidder), lot.id, { minIncrementCents: 100 })).statusCode).toBe(403);
    expect((await patch(null, lot.id, { minIncrementCents: 100 })).statusCode).toBe(401);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await patch(tokenFor(app, other), unknown, { minIncrementCents: 100 })).statusCode).toBe(404);
  });

  it("answers the CORS preflight for PATCH", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/lots/00000000-0000-4000-8000-000000000000",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "PATCH" },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("a bid after the edit is checked against the new starting bid", async () => {
    const { lot, token } = await auctioneerWithLot({ startsInMs: -HOUR, endsInMs: HOUR });
    await patch(token, lot.id, { startingBidCents: 5_000_000 });
    const bidder = await createUser("bidder");
    await fund(bidder.id, 10_000_000);

    const low = await app.inject({
      method: "POST",
      url: `/lots/${lot.id}/bids`,
      headers: authHeader(tokenFor(app, bidder)),
      payload: { amountCents: 4_999_999 },
    });
    expect(low.json().code).toBe("BID_BELOW_MIN");
  });
});
