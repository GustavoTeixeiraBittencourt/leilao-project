import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { authHeader, createUser, tokenFor } from "./helpers.js";

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
});
