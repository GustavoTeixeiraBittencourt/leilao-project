import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { lockLot } from "../src/db/locks.js";
import { subscribeLotEvents, type LotEvent } from "../src/lib/events.js";
import { settleLot } from "../src/modules/settlement/service.js";
import { authHeader, createLotRow, createUser, fund, tokenFor } from "./helpers.js";

const HOUR = 3_600_000;

describe("POST /lots/:id/cancel", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
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

  function cancel(token: string | null, lotId: string) {
    return app.inject({
      method: "POST",
      url: `/lots/${lotId}/cancel`,
      headers: token ? authHeader(token) : {},
    });
  }

  async function auctioneerWithLot(options: Parameters<typeof createLotRow>[0] extends infer O ? Partial<O> : never = {}) {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id, ...options });
    return { auctioneer, lot, token: tokenFor(app, auctioneer) };
  }

  describe("allowed", () => {
    it("cancels a scheduled lot without bids", async () => {
      const { lot, token } = await auctioneerWithLot({ startsInMs: HOUR, endsInMs: 2 * HOUR });

      const response = await cancel(token, lot.id);

      expect(response.statusCode).toBe(200);
      expect(response.json().lot).toMatchObject({ id: lot.id, status: "cancelled", phase: "cancelled" });
      expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe("cancelled");
    });

    // O navegador envia Content-Type: application/json também neste POST sem corpo; o Fastify
    // recusava ("JSON vazio") e o botão "Confirmar cancelamento" mostrava erro interno.
    it("accepts the browser's request: JSON content-type with an empty body", async () => {
      const { lot, token } = await auctioneerWithLot();

      const response = await app.inject({
        method: "POST",
        url: `/lots/${lot.id}/cancel`,
        headers: { ...authHeader(token), "content-type": "application/json" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().lot.phase).toBe("cancelled");
    });

    it("answers malformed JSON with 400, not 500", async () => {
      const { token } = await auctioneerWithLot();

      const response = await app.inject({
        method: "POST",
        url: "/lots",
        headers: { ...authHeader(token), "content-type": "application/json" },
        payload: "{not json",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_ERROR");
    });

    it("cancels a live lot that has no bids", async () => {
      const { lot, token } = await auctioneerWithLot();

      const response = await cancel(token, lot.id);

      expect(response.statusCode).toBe(200);
      expect(response.json().lot.phase).toBe("cancelled");
    });

    it("removes the lot from the showcase and from the counts, and bids are refused afterwards", async () => {
      const { lot, token } = await auctioneerWithLot({ title: `cancelme-${randomUUID().slice(0, 8)}` });
      const bidder = await newBidder();
      await cancel(token, lot.id);

      const listing = await app.inject({ method: "GET", url: `/lots?q=${encodeURIComponent(lot.title)}&phase=live` });
      expect(listing.json().lots).toHaveLength(0);
      expect(listing.json().counts.live).toBe(0);

      const response = await bid(bidder.token, lot.id, 10_000);
      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("LOT_CLOSED");
    });

    it("tells the people in the lot room that it was cancelled", async () => {
      const { lot, token } = await auctioneerWithLot();
      const events: LotEvent[] = [];
      const unsubscribe = subscribeLotEvents(lot.id, (event) => events.push(event));

      await cancel(token, lot.id);
      unsubscribe();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "lot_cancelled", lotId: lot.id });
    });
  });

  describe("refused", () => {
    it("LOT_HAS_BIDS: a lot with bids cannot be cancelled and stays untouched", async () => {
      const { lot, token } = await auctioneerWithLot();
      const bidder = await newBidder();
      await bid(bidder.token, lot.id, 10_000);

      const response = await cancel(token, lot.id);

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe("LOT_HAS_BIDS");
      const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(stored).toMatchObject({ status: "open", bidCount: 1 });
    });

    it("LOT_NOT_CANCELLABLE: closed, overdue and already-cancelled lots", async () => {
      const closed = await auctioneerWithLot({ startsInMs: -3 * HOUR, endsInMs: -2 * HOUR });
      await settleLot(closed.lot.id);
      const overdue = await auctioneerWithLot({ startsInMs: -3 * HOUR, endsInMs: -1_000 });
      const twice = await auctioneerWithLot();
      expect((await cancel(twice.token, twice.lot.id)).statusCode).toBe(200);

      for (const { lot, token } of [closed, overdue, twice]) {
        const response = await cancel(token, lot.id);
        expect(response.statusCode).toBe(409);
        expect(response.json().code).toBe("LOT_NOT_CANCELLABLE");
      }
    });

    it("FORBIDDEN: another auctioneer cannot cancel someone else's lot", async () => {
      const { lot } = await auctioneerWithLot();
      const intruder = await createUser("auctioneer");

      const response = await cancel(tokenFor(app, intruder), lot.id);

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe("FORBIDDEN");
      expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe("open");
    });

    it("a bidder cannot cancel, and anonymous requests are rejected", async () => {
      const { lot } = await auctioneerWithLot();
      const bidder = await newBidder();

      expect((await cancel(bidder.token, lot.id)).statusCode).toBe(403);
      expect((await cancel(null, lot.id)).statusCode).toBe(401);
    });

    it("404 for an unknown lot and 400 for a malformed id", async () => {
      const { token } = await auctioneerWithLot();

      expect((await cancel(token, randomUUID())).statusCode).toBe(404);
      expect((await cancel(token, "not-a-uuid")).statusCode).toBe(400);
    });
  });

  describe("concurrency with bids", () => {
    it("waits for the lot lock and re-reads the bid count (deterministic)", async () => {
      // Uma transação segura o lock do lote e registra um "lance" (bid_count = 1)
      // antes de commitar. O cancelamento disparado nesse meio tempo TEM que esperar
      // o lock e então enxergar o lance novo. Sem o FOR UPDATE ele leria o contador
      // antigo (0), esperaria só no UPDATE e cancelaria um lote que já tem lance.
      const { lot, token } = await auctioneerWithLot();
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquired!: () => void;
      const lockAcquired = new Promise<void>((resolve) => (acquired = resolve));
      const holder = prisma.$transaction(
        async (tx) => {
          await lockLot(tx, lot.id);
          await tx.lot.update({ where: { id: lot.id }, data: { bidCount: 1 } });
          acquired();
          await held;
        },
        { timeout: 10_000 },
      );
      await lockAcquired;

      let settled = false;
      const cancelling = cancel(token, lot.id).then((response) => {
        settled = true;
        return response;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);

      release();
      await holder;
      const response = await cancelling;
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe("LOT_HAS_BIDS");
      expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe("open");
    });

    it("a cancel and a bid at the same time never both win", async () => {
      // O lance e o cancelamento disputam o MESMO lock do lote. Dois desfechos
      // possíveis e coerentes: cancelou (lance recusado com LOT_CLOSED) ou o lance
      // entrou (cancelamento recusado com LOT_HAS_BIDS). Nunca lote cancelado COM lance.
      const rounds = await Promise.all(
        Array.from({ length: 12 }, async () => {
          const { lot, token } = await auctioneerWithLot();
          const bidder = await newBidder();
          const [cancelResponse, bidResponse] = await Promise.all([cancel(token, lot.id), bid(bidder.token, lot.id, 10_000)]);
          return { lot, cancelResponse, bidResponse };
        }),
      );

      for (const { lot, cancelResponse, bidResponse } of rounds) {
        const stored = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
        const cancelled = cancelResponse.statusCode === 200;
        const bidAccepted = bidResponse.statusCode === 201;
        expect(cancelled !== bidAccepted).toBe(true); // exatamente um dos dois
        if (cancelled) {
          expect(bidResponse.json().code).toBe("LOT_CLOSED");
          expect(stored).toMatchObject({ status: "cancelled", bidCount: 0 });
        } else {
          expect(cancelResponse.json().code).toBe("LOT_HAS_BIDS");
          expect(stored).toMatchObject({ status: "open", bidCount: 1 });
        }
      }
    });
  });
});
