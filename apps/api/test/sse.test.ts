import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/db/client.js";
import { lotListenerCount } from "../src/lib/events.js";
import { settleLot } from "../src/modules/settlement/service.js";
import { authHeader, createLotRow, createUser, fund, tokenFor } from "./helpers.js";

type SseEvent = { event: string; data: Record<string, unknown> };

// Cliente SSE mínimo sobre fetch, para ler o stream de verdade (a camada real do
// EventSource do navegador é só um parser disto + reconexão automática).
async function openStream(base: string, path: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const response = await fetch(`${base}${path}`, {
    headers: { accept: "text/event-stream", ...headers },
    signal: controller.signal,
  });
  const events: SseEvent[] = [];

  void (async () => {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
      }
    } catch {
      // abort do teste: esperado
    }
  })();

  async function waitFor(predicate: (event: SseEvent) => boolean, timeoutMs = 3_000): Promise<SseEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = events.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timed out; got: ${JSON.stringify(events.map((e) => e.event))}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  return { response, events, waitFor, close: () => controller.abort() };
}

describe("SSE /lots/:id/events", () => {
  let app: FastifyInstance;
  let base: string;
  const opened: Array<{ close: () => void }> = [];

  async function listen(instance: FastifyInstance) {
    await instance.listen({ port: 0, host: "127.0.0.1" });
    return `http://127.0.0.1:${(instance.server.address() as AddressInfo).port}`;
  }

  async function stream(path: string, headers?: Record<string, string>, url = base) {
    const connection = await openStream(url, path, headers);
    opened.push(connection);
    return connection;
  }

  beforeAll(async () => {
    app = await buildApp();
    base = await listen(app);
  });

  afterAll(async () => {
    opened.forEach((connection) => connection.close());
    await app.close();
    await prisma.$disconnect();
  });

  async function newBidder() {
    const user = await createUser("bidder");
    await fund(user.id, 1_000_000);
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

  it("answers 404 for an unknown lot and 400 for a malformed id, as plain JSON", async () => {
    const unknown = await app.inject({ method: "GET", url: "/lots/00000000-0000-4000-8000-000000000000/events" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe("NOT_FOUND");

    const malformed = await app.inject({ method: "GET", url: "/lots/not-a-uuid/events" });
    expect(malformed.statusCode).toBe(400);
  });

  it("opens an event stream with the right headers, CORS for the front-end origin, and a ready event", async () => {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id });

    const connection = await stream(`/lots/${lot.id}/events`, { origin: env.CORS_ORIGIN });

    expect(connection.response.status).toBe(200);
    expect(connection.response.headers.get("content-type")).toContain("text/event-stream");
    expect(connection.response.headers.get("cache-control")).toContain("no-cache");
    // O EventSource vindo do Vercel só funciona se o CORS passar pelo stream hijackeado.
    expect(connection.response.headers.get("access-control-allow-origin")).toBe(env.CORS_ORIGIN);
    const ready = await connection.waitFor((e) => e.event === "ready");
    expect(ready.data.lotId).toBe(lot.id);
    expect(new Date(ready.data.serverNow as string).getTime()).not.toBeNaN();
  });

  it("pushes bid_placed to every subscriber right after a bid, with the public payload", async () => {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id });
    const first = await stream(`/lots/${lot.id}/events`);
    const second = await stream(`/lots/${lot.id}/events`);
    await first.waitFor((e) => e.event === "ready");
    await second.waitFor((e) => e.event === "ready");
    const { user, token } = await newBidder();

    expect((await bid(token, lot.id, 12_000)).statusCode).toBe(201);

    for (const connection of [first, second]) {
      const event = await connection.waitFor((e) => e.event === "bid_placed");
      expect(event.data).toMatchObject({
        type: "bid_placed",
        lotId: lot.id,
        currentBidCents: 12_000,
        bidCount: 1,
        leaderAlias: user.publicAlias,
        extended: false,
        bid: { seq: 1, bidderAlias: user.publicAlias, amountCents: 12_000 },
      });
      expect(JSON.stringify(event.data)).not.toContain(user.email);
    }
  });

  it("flags an anti-sniping extension in the event", async () => {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id, endsInMs: 30_000 });
    const connection = await stream(`/lots/${lot.id}/events`);
    await connection.waitFor((e) => e.event === "ready");
    const { token } = await newBidder();

    await bid(token, lot.id, 10_000);

    const event = await connection.waitFor((e) => e.event === "bid_placed");
    expect(event.data.extended).toBe(true);
    expect(new Date(event.data.endsAt as string).getTime()).toBeGreaterThan(lot.endsAt.getTime());
  });

  it("only delivers events of the lot being watched", async () => {
    const auctioneer = await createUser("auctioneer");
    const watched = await createLotRow({ auctioneerId: auctioneer.id });
    const other = await createLotRow({ auctioneerId: auctioneer.id });
    const connection = await stream(`/lots/${watched.id}/events`);
    await connection.waitFor((e) => e.event === "ready");
    const { token } = await newBidder();

    await bid(token, other.id, 10_000);
    const second = await newBidder();
    await bid(second.token, watched.id, 10_000);

    await connection.waitFor((e) => e.event === "bid_placed");
    const placed = connection.events.filter((e) => e.event === "bid_placed");
    expect(placed).toHaveLength(1);
    expect(placed[0]!.data.lotId).toBe(watched.id);
  });

  it("pushes lot_closed when the lot is settled and lot_cancelled when it is cancelled", async () => {
    const auctioneer = await createUser("auctioneer");
    const closing = await createLotRow({ auctioneerId: auctioneer.id });
    const cancelling = await createLotRow({ auctioneerId: auctioneer.id });
    const closedStream = await stream(`/lots/${closing.id}/events`);
    const cancelledStream = await stream(`/lots/${cancelling.id}/events`);
    await closedStream.waitFor((e) => e.event === "ready");
    await cancelledStream.waitFor((e) => e.event === "ready");
    const { user, token } = await newBidder();
    await bid(token, closing.id, 10_000);
    await prisma.lot.update({ where: { id: closing.id }, data: { endsAt: new Date(Date.now() - 1_000) } });

    await settleLot(closing.id);
    await app.inject({ method: "POST", url: `/lots/${cancelling.id}/cancel`, headers: authHeader(tokenFor(app, auctioneer)) });

    const closed = await closedStream.waitFor((e) => e.event === "lot_closed");
    expect(closed.data).toMatchObject({ lotId: closing.id, winnerAlias: user.publicAlias, finalPriceCents: 10_000 });
    const cancelled = await cancelledStream.waitFor((e) => e.event === "lot_cancelled");
    expect(cancelled.data).toMatchObject({ type: "lot_cancelled", lotId: cancelling.id });
  });

  it("releases the subscriber when the client disconnects", async () => {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id });
    const connection = await stream(`/lots/${lot.id}/events`);
    await connection.waitFor((e) => e.event === "ready");
    expect(lotListenerCount(lot.id)).toBe(1);

    connection.close();

    const deadline = Date.now() + 3_000;
    while (lotListenerCount(lot.id) > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(lotListenerCount(lot.id)).toBe(0);
  });

  it("shuts the server down promptly even with a stream still open (SIGTERM on deploy)", async () => {
    // Uma conexão SSE nunca termina sozinha. Se app.close() esperasse por ela, todo
    // deploy/restart ficaria pendurado até o orquestrador matar o processo.
    const closing = await buildApp();
    const closingBase = await listen(closing);
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id });
    const connection = await stream(`/lots/${lot.id}/events`, undefined, closingBase);
    await connection.waitFor((e) => e.event === "ready");

    const startedAt = Date.now();
    await closing.close();

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("sends periodic pings carrying the server clock", async () => {
    const fast = await buildApp({ sseHeartbeatMs: 100 });
    const fastBase = await listen(fast);
    try {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const connection = await stream(`/lots/${lot.id}/events`, undefined, fastBase);

      await connection.waitFor((e) => e.event === "ping");
      await connection.waitFor(() => connection.events.filter((e) => e.event === "ping").length >= 2);

      const ping = connection.events.find((e) => e.event === "ping")!;
      expect(new Date(ping.data.serverNow as string).getTime()).not.toBeNaN();
      connection.close();
    } finally {
      await fast.close();
    }
  });
});
