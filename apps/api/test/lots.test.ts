import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { authHeader, createLotRow, createUser, tokenFor } from "./helpers.js";

describe("lots", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      externalId: "27992",
      title: "A Sunday on La Grande Jatte",
      imageUrl: "https://openaccess-cdn.clevelandart.org/2001.19/2001.19_web.jpg",
      attributes: { artist_display: "Georges Seurat", date_display: "1884-86" },
      startingBidCents: 100_000,
      minIncrementCents: 5_000,
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 7_200_000).toISOString(),
      ...overrides,
    };
  }

  it("lets an auctioneer create a lot and snapshots the item attributes", async () => {
    const auctioneer = await createUser("auctioneer");
    const response = await app.inject({
      method: "POST",
      url: "/lots",
      headers: authHeader(tokenFor(app, auctioneer)),
      payload: payload(),
    });

    expect(response.statusCode).toBe(201);
    const { lot } = response.json();
    expect(lot).toMatchObject({
      title: "A Sunday on La Grande Jatte",
      startingBidCents: 100_000,
      minIncrementCents: 5_000,
      currentBidCents: null,
      bidCount: 0,
      leaderAlias: null,
      phase: "scheduled",
      status: "open",
    });
    expect(lot.attributes.artist_display).toBe("Georges Seurat");

    const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(stored.auctioneerId).toBe(auctioneer.id);
  });

  it("does not let a bidder create a lot", async () => {
    const bidder = await createUser("bidder");
    const response = await app.inject({
      method: "POST",
      url: "/lots",
      headers: authHeader(tokenFor(app, bidder)),
      payload: payload(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("FORBIDDEN");
  });

  it("rejects invalid lots", async () => {
    const auctioneer = await createUser("auctioneer");
    const headers = authHeader(tokenFor(app, auctioneer));
    const now = Date.now();

    const invalid = [
      payload({ endsAt: new Date(now + 1_000).toISOString(), startsAt: new Date(now + 5_000).toISOString() }),
      payload({ startsAt: new Date(now - 7_200_000).toISOString(), endsAt: new Date(now - 3_600_000).toISOString() }),
      payload({ startingBidCents: 0 }),
      payload({ minIncrementCents: -1 }),
      payload({ startingBidCents: 10.5 }),
      payload({ imageUrl: "http://insecure.example/img.jpg" }),
    ];
    for (const body of invalid) {
      const response = await app.inject({ method: "POST", url: "/lots", headers, payload: body });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_ERROR");
    }
  });

  it("derives the phase from the server clock, publicly", async () => {
    const auctioneer = await createUser("auctioneer");
    const scheduled = await createLotRow({ auctioneerId: auctioneer.id, startsInMs: 3_600_000, endsInMs: 7_200_000 });
    const live = await createLotRow({ auctioneerId: auctioneer.id });
    const overdue = await createLotRow({ auctioneerId: auctioneer.id, startsInMs: -7_200_000, endsInMs: -1_000 });
    const cancelled = await createLotRow({ auctioneerId: auctioneer.id });
    await prisma.lot.update({ where: { id: cancelled.id }, data: { status: "cancelled" } });

    const expected = [
      [scheduled.id, "scheduled"],
      [live.id, "live"],
      [overdue.id, "ended"],
      [cancelled.id, "cancelled"],
    ] as const;
    for (const [id, phase] of expected) {
      const response = await app.inject({ method: "GET", url: `/lots/${id}` });
      expect(response.statusCode).toBe(200);
      expect(response.json().lot.phase).toBe(phase);
      expect(new Date(response.json().lot.serverNow).getTime()).not.toBeNaN();
    }
  });

  it("returns 404 for an unknown lot and 400 for a malformed id", async () => {
    const unknown = await app.inject({ method: "GET", url: `/lots/${randomUUID()}` });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe("NOT_FOUND");

    const malformed = await app.inject({ method: "GET", url: "/lots/not-a-uuid" });
    expect(malformed.statusCode).toBe(400);
  });
});
