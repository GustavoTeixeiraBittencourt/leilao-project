import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { lockBidder } from "../src/db/locks.js";
import { genesisHash } from "../src/lib/hash-chain.js";
import { subscribeLotEvents, type LotEvent } from "../src/lib/events.js";
import { closeDueLots, settleLot } from "../src/modules/settlement/service.js";
import { getBalance } from "../src/modules/wallet/service.js";
import { startCloser } from "../src/worker/closer.js";
import { authHeader, createLotRow, createUser, fund, tokenFor } from "./helpers.js";

describe("settlement", () => {
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

  // Faz o lote "vencer" sem esperar: lances só são aceitos enquanto ao vivo,
  // então os testes dão os lances e depois empurram ends_at para o passado.
  async function expire(lotId: string) {
    await prisma.lot.update({ where: { id: lotId }, data: { endsAt: new Date(Date.now() - 1_000) } });
  }

  const entriesOf = (lotId: string) => prisma.walletEntry.findMany({ where: { lotId } });

  describe("closing a lot with bids", () => {
    it("debits the winner, credits the auctioneer, issues a receipt and seals the chain", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 10_000, minIncrementCents: 1_000 });
      const loser = await newBidder(50_000);
      const winner = await newBidder(50_000);
      await bid(loser.token, lot.id, 10_000);
      await bid(winner.token, lot.id, 12_000);
      await expire(lot.id);

      const result = await settleLot(lot.id);

      expect(result).toMatchObject({ lotId: lot.id, winnerAlias: winner.user.publicAlias, finalPriceCents: 12_000n });
      const closed = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(closed).toMatchObject({ status: "closed", winnerId: winner.user.id, finalPriceCents: 12_000n });
      expect(closed.closedAt).not.toBeNull();

      const entries = await entriesOf(lot.id);
      expect(entries).toHaveLength(2);
      expect(entries.find((e) => e.userId === winner.user.id)).toMatchObject({ kind: "settlement_debit", amountCents: -12_000n });
      expect(entries.find((e) => e.userId === auctioneer.id)).toMatchObject({ kind: "settlement_credit", amountCents: 12_000n });
      // O superado não é cobrado.
      expect(entries.some((e) => e.userId === loser.user.id)).toBe(false);

      const lastBid = await prisma.bid.findFirstOrThrow({ where: { lotId: lot.id }, orderBy: { seq: "desc" } });
      expect(closed).toMatchObject({ sealCount: 2, sealHash: lastBid.hash });
      const receipt = await prisma.receipt.findUniqueOrThrow({ where: { lotId: lot.id } });
      expect(receipt).toMatchObject({ winnerId: winner.user.id, amountCents: 12_000n, sealCount: 2, sealHash: lastBid.hash });
      expect(receipt.publicToken.length).toBeGreaterThanOrEqual(22);

      expect(await getBalance(prisma, winner.user.id)).toMatchObject({ totalCents: 38_000n, committedCents: 0n, availableCents: 38_000n });
      expect(await getBalance(prisma, loser.user.id)).toMatchObject({ totalCents: 50_000n, committedCents: 0n });
      expect(await getBalance(prisma, auctioneer.id)).toMatchObject({ totalCents: 12_000n });
    });

    it("keeps the ledger balanced: what leaves the winner enters the auctioneer", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const { token } = await newBidder();
      await bid(token, lot.id, 25_000);
      await expire(lot.id);

      await settleLot(lot.id);

      const sum = (await entriesOf(lot.id)).reduce((total, entry) => total + entry.amountCents, 0n);
      expect(sum).toBe(0n);
    });
  });

  describe("closing a lot without bids", () => {
    it("closes with no winner, no money movement and a genesis seal", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      await expire(lot.id);

      const result = await settleLot(lot.id);

      expect(result).toMatchObject({ lotId: lot.id, winnerAlias: null, finalPriceCents: null });
      const closed = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(closed).toMatchObject({ status: "closed", winnerId: null, finalPriceCents: null, sealCount: 0 });
      expect(closed.sealHash).toBe(
        genesisHash({
          lotId: lot.id,
          auctioneerId: auctioneer.id,
          startingBidCents: lot.startingBidCents,
          minIncrementCents: lot.minIncrementCents,
          startsAt: lot.startsAt,
        }),
      );
      expect(await entriesOf(lot.id)).toHaveLength(0);
      expect(await prisma.receipt.count({ where: { lotId: lot.id } })).toBe(0);
    });
  });

  describe("when a lot must NOT be closed", () => {
    it("ignores a lot that is still live", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });

      expect(await settleLot(lot.id)).toBeNull();
      await closeDueLots();

      expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe("open");
    });

    it("does not close a lot that anti-sniping just extended", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, endsInMs: 30_000 });
      const { token } = await newBidder();
      expect((await bid(token, lot.id, 10_000)).json().extended).toBe(true);

      await closeDueLots();

      expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe("open");
    });

    it("refuses bids once the lot is closed", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const { token } = await newBidder();
      await expire(lot.id);
      await settleLot(lot.id);

      const response = await bid(token, lot.id, 10_000);

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("LOT_CLOSED");
    });
  });

  describe("idempotency", () => {
    it("settles exactly once even with many simultaneous attempts", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const winner = await newBidder(100_000);
      await bid(winner.token, lot.id, 30_000);
      await expire(lot.id);

      // Mistura os dois caminhos reais: por id (leitura preguiçosa) e pelo worker.
      await Promise.all([
        ...Array.from({ length: 8 }, () => settleLot(lot.id)),
        ...Array.from({ length: 3 }, () => closeDueLots()),
      ]);

      const entries = await entriesOf(lot.id);
      expect(entries.filter((e) => e.kind === "settlement_debit")).toHaveLength(1);
      expect(entries.filter((e) => e.kind === "settlement_credit")).toHaveLength(1);
      expect(await prisma.receipt.count({ where: { lotId: lot.id } })).toBe(1);
      expect(await getBalance(prisma, winner.user.id)).toMatchObject({ totalCents: 70_000n });
    });

    it("is a no-op when called again after closing", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const { token } = await newBidder();
      await bid(token, lot.id, 10_000);
      await expire(lot.id);

      expect(await settleLot(lot.id)).not.toBeNull();
      const before = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(await settleLot(lot.id)).toBeNull();

      const after = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
      expect(after.closedAt).toEqual(before.closedAt);
      expect(await entriesOf(lot.id)).toHaveLength(2);
    });
  });

  describe("closing paths", () => {
    it("closes lazily when the lot is read after its end", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const { user, token } = await newBidder();
      await bid(token, lot.id, 10_000);
      await expire(lot.id);

      const response = await app.inject({ method: "GET", url: `/lots/${lot.id}` });

      expect(response.json().lot).toMatchObject({ status: "closed", phase: "ended", leaderAlias: user.publicAlias });
      expect(await prisma.receipt.count({ where: { lotId: lot.id } })).toBe(1);
    });

    it("closes through the real worker loop, without any request", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const { token } = await newBidder();
      await bid(token, lot.id, 10_000);
      await expire(lot.id);

      const closer = startCloser({ intervalMs: 200, logger: { info: () => {}, error: () => {} } });
      try {
        const deadline = Date.now() + 5_000;
        let status = "open";
        while (status === "open" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          status = (await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status;
        }
        expect(status).toBe("closed");
      } finally {
        await closer.stop();
      }
    });

    it("publishes a lot_closed event only after the commit", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const { user, token } = await newBidder();
      await bid(token, lot.id, 10_000);
      await expire(lot.id);
      const events: LotEvent[] = [];
      const unsubscribe = subscribeLotEvents(lot.id, (event) => events.push(event));

      await settleLot(lot.id);
      unsubscribe();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "lot_closed", winnerAlias: user.publicAlias, finalPriceCents: 10_000 });
    });
  });

  describe("concurrency with bids", () => {
    it("waits for the winner's row lock before settling (lot -> bidder lock order)", async () => {
      // Teste DETERMINÍSTICO do comportamento que protege contra overcommit: a
      // liquidação não pode concluir enquanto outra transação segura a linha do
      // vencedor (é o que um lance do vencedor faz). Segura o lock numa transação
      // à parte e exige que a liquidação espere.
      // Limite: este teste não distingue o lockBidder explícito do KEY SHARE que
      // o FK do débito já toma (removi o lock e ele seguiu passando). Ele guarda
      // o COMPORTAMENTO; se alguém mudar a liquidação a ponto de perder as duas
      // proteções, ele falha.
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      const winner = await newBidder();
      await bid(winner.token, lot.id, 10_000);
      await expire(lot.id);

      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquired!: () => void;
      const lockAcquired = new Promise<void>((resolve) => (acquired = resolve));
      const holder = prisma.$transaction(
        async (tx) => {
          await lockBidder(tx, winner.user.id);
          acquired();
          await held;
        },
        { timeout: 10_000 },
      );
      await lockAcquired;

      let settled = false;
      const settling = settleLot(lot.id).then((result) => {
        settled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);

      release();
      await holder;
      expect(await settling).not.toBeNull();
      expect(settled).toBe(true);
    });

    it("never lets a winner overcommit while their own lot is being settled (stress)", async () => {
      // Teste de estresse "best effort": o vencedor tem 20.000, lidera o lote A a
      // 15.000 (disponível 5.000) e tenta cobrir 6.000 no lote B ENQUANTO A é
      // liquidado. Antes e depois da liquidação o disponível é 5.000, então o
      // lance NUNCA pode passar. Best effort: a janela de uma corrida real é
      // minúscula, então este teste sozinho não prova ausência de race.
      const auctioneer = await createUser("auctioneer");
      const rounds = await Promise.all(
        Array.from({ length: 15 }, async () => {
          const winner = await newBidder(20_000);
          const lotA = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 15_000 });
          const lotB = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 6_000 });
          expect((await bid(winner.token, lotA.id, 15_000)).statusCode).toBe(201);
          await expire(lotA.id);
          return { winner, lotA, lotB };
        }),
      );

      const outcomes = await Promise.all(
        rounds.map(async ({ winner, lotA, lotB }) => {
          const [, response] = await Promise.all([settleLot(lotA.id), bid(winner.token, lotB.id, 6_000)]);
          return { response, winner };
        }),
      );

      for (const { response, winner } of outcomes) {
        expect(response.statusCode).toBe(422);
        expect(response.json().code).toBe("INSUFFICIENT_FUNDS");
        const balance = await getBalance(prisma, winner.user.id);
        expect(balance).toMatchObject({ totalCents: 5_000n, committedCents: 0n });
      }
    });
  });
});
