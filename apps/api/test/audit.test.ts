import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { settleLot } from "../src/modules/settlement/service.js";
import { authHeader, createLotRow, createUser, fund, tokenFor } from "./helpers.js";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

describe("audit", () => {
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

  async function audit(lotId: string) {
    const response = await app.inject({ method: "GET", url: `/audit/lots/${lotId}` });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  // Ataque de quem tem acesso direto ao banco. `session_replication_role =
  // replica` desliga as triggers append-only SÓ nesta transação (e portanto
  // só nesta sessão): simula um dono do banco contornando a defesa extra, sem
  // afetar os outros testes que rodam em paralelo.
  async function tamper(attack: (tx: Tx) => Promise<unknown>) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await attack(tx);
    });
  }

  // Lote com 3 lances (A 10.000, B 11.000, A 12.000), vencido e liquidado.
  async function closedLot() {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 10_000, minIncrementCents: 1_000 });
    const a = await newBidder();
    const b = await newBidder();
    await bid(a.token, lot.id, 10_000);
    await bid(b.token, lot.id, 11_000);
    await bid(a.token, lot.id, 12_000);
    await prisma.lot.update({ where: { id: lot.id }, data: { endsAt: new Date(Date.now() - 1_000) } });
    await settleLot(lot.id);
    return { lot, auctioneer, a, b };
  }

  // Lote ainda ABERTO com 3 lances.
  async function openLot() {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id, startingBidCents: 10_000, minIncrementCents: 1_000 });
    const a = await newBidder();
    const b = await newBidder();
    await bid(a.token, lot.id, 10_000);
    await bid(b.token, lot.id, 11_000);
    await bid(a.token, lot.id, 12_000);
    return { lot, auctioneer, a, b };
  }

  describe("intact lots", () => {
    it("reports a closed lot as intact and sealed, with the full public history", async () => {
      const { lot, a, b } = await closedLot();

      const body = await audit(lot.id);

      expect(body).toMatchObject({ verdict: "intact", firstBreak: null, sealed: true, checkedBids: 3 });
      expect(body.lot).toMatchObject({ status: "closed", phase: "ended", bidCount: 3, finalPriceCents: 12_000 });
      expect(body.lot.winnerAlias).toBe(a.user.publicAlias);
      expect(body.bids.map((row: { seq: number }) => row.seq)).toEqual([1, 2, 3]);
      expect(body.bids[1].bidderAlias).toBe(b.user.publicAlias);
      expect(body.seal).toMatchObject({ count: 3, hash: body.bids[2].hash });
    });

    it("reports an open lot as intact but NOT sealed", async () => {
      const { lot } = await openLot();

      const body = await audit(lot.id);

      expect(body).toMatchObject({ verdict: "intact", sealed: false, seal: null, checkedBids: 3 });
    });

    it("reports a lot with no bids as intact", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });

      expect(await audit(lot.id)).toMatchObject({ verdict: "intact", checkedBids: 0, bids: [] });
    });

    it("is public, closes an overdue lot lazily, and 404s on unknown lots", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id, startsInMs: -3_600_000, endsInMs: -1_000 });

      const body = await audit(lot.id);
      expect(body.lot.status).toBe("closed");
      expect(body).toMatchObject({ verdict: "intact", sealed: true });

      const unknown = await app.inject({ method: "GET", url: "/audit/lots/00000000-0000-4000-8000-000000000000" });
      expect(unknown.statusCode).toBe(404);
    });

    it("exposes only pseudonymous aliases: no e-mail and no display name", async () => {
      const { lot, a, b, auctioneer } = await closedLot();

      const response = await app.inject({ method: "GET", url: `/audit/lots/${lot.id}` });

      for (const person of [a.user, b.user, auctioneer]) {
        expect(response.body).not.toContain(person.email);
        expect(response.body).not.toContain(person.displayName);
      }
      expect(response.body).toContain(a.user.publicAlias);
    });
  });

  describe("tampering detected on a closed lot", () => {
    it("an edited bid amount breaks that bid's hash", async () => {
      const { lot } = await closedLot();
      await tamper((tx) => tx.$executeRaw`UPDATE bids SET amount_cents = 1 WHERE lot_id = ${lot.id}::uuid AND seq = 2`);

      expect(await audit(lot.id)).toMatchObject({
        verdict: "tampered",
        firstBreak: { seq: 2, reason: "HASH_MISMATCH" },
      });
    });

    it("a removed middle bid breaks the sequence", async () => {
      const { lot } = await closedLot();
      await tamper((tx) => tx.$executeRaw`DELETE FROM bids WHERE lot_id = ${lot.id}::uuid AND seq = 2`);

      expect(await audit(lot.id)).toMatchObject({
        verdict: "tampered",
        firstBreak: { seq: 2, reason: "SEQ_GAP" },
      });
    });

    it("a removed last bid is caught by the lot's own count", async () => {
      const { lot } = await closedLot();
      await tamper((tx) => tx.$executeRaw`DELETE FROM bids WHERE lot_id = ${lot.id}::uuid AND seq = 3`);

      expect(await audit(lot.id)).toMatchObject({
        verdict: "tampered",
        firstBreak: { seq: 3, reason: "BID_COUNT_MISMATCH" },
      });
    });

    it("a removed last bid with the lot columns rewritten to match is still caught by the seal", async () => {
      // O atacante esperto também ajusta bid_count/lance atual/líder. A cadeia
      // fica coerente, mas o SELO (contagem + hash final) foi gravado no
      // fechamento e o comprovante também: é isso que denuncia.
      const { lot, b } = await closedLot();
      await tamper(async (tx) => {
        await tx.$executeRaw`DELETE FROM bids WHERE lot_id = ${lot.id}::uuid AND seq = 3`;
        await tx.$executeRaw`UPDATE lots SET bid_count = 2, current_bid_cents = 11000, leader_id = ${b.user.id}::uuid WHERE id = ${lot.id}::uuid`;
      });

      expect(await audit(lot.id)).toMatchObject({
        verdict: "tampered",
        sealed: true,
        firstBreak: { reason: "SEAL_MISMATCH" },
      });
    });

    it("a forged bid appended with a made-up hash is rejected", async () => {
      const { lot, b } = await closedLot();
      await tamper(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO bids (lot_id, bidder_id, amount_cents, placed_at, seq, prev_hash, hash)
          VALUES (${lot.id}::uuid, ${b.user.id}::uuid, 99000, now(), 4, ${"0".repeat(64)}, ${"f".repeat(64)})`;
      });

      expect(await audit(lot.id)).toMatchObject({
        verdict: "tampered",
        firstBreak: { seq: 4, reason: "PREV_HASH_MISMATCH" },
      });
    });

    it("swapped bids are rejected", async () => {
      const { lot } = await closedLot();
      await tamper(async (tx) => {
        // seq é UNIQUE por lote: passa por um valor temporário para trocar 1 <-> 2.
        await tx.$executeRaw`UPDATE bids SET seq = 99 WHERE lot_id = ${lot.id}::uuid AND seq = 1`;
        await tx.$executeRaw`UPDATE bids SET seq = 1 WHERE lot_id = ${lot.id}::uuid AND seq = 2`;
        await tx.$executeRaw`UPDATE bids SET seq = 2 WHERE lot_id = ${lot.id}::uuid AND seq = 99`;
      });

      expect(await audit(lot.id)).toMatchObject({ verdict: "tampered", firstBreak: { seq: 1 } });
    });

    it("an edited final price is rejected", async () => {
      const { lot } = await closedLot();
      await tamper((tx) => tx.$executeRaw`UPDATE lots SET final_price_cents = 1 WHERE id = ${lot.id}::uuid`);

      expect(await audit(lot.id)).toMatchObject({ verdict: "tampered", firstBreak: { reason: "SEAL_MISMATCH" } });
    });

    it("an edited lot current bid is rejected", async () => {
      const { lot } = await closedLot();
      await tamper((tx) => tx.$executeRaw`UPDATE lots SET current_bid_cents = 5 WHERE id = ${lot.id}::uuid`);

      expect(await audit(lot.id)).toMatchObject({
        verdict: "tampered",
        firstBreak: { reason: "LOT_SUMMARY_MISMATCH" },
      });
    });

    it("an edited receipt is rejected", async () => {
      const { lot } = await closedLot();
      await tamper((tx) => tx.$executeRaw`UPDATE receipts SET amount_cents = 1 WHERE lot_id = ${lot.id}::uuid`);

      expect(await audit(lot.id)).toMatchObject({ verdict: "tampered", firstBreak: { reason: "RECEIPT_MISMATCH" } });
    });

    it("a bid injected into a closed lot WITHOUT bids is rejected", async () => {
      const auctioneer = await createUser("auctioneer");
      const lot = await createLotRow({ auctioneerId: auctioneer.id });
      await prisma.lot.update({ where: { id: lot.id }, data: { endsAt: new Date(Date.now() - 1_000) } });
      await settleLot(lot.id);
      const intruder = await newBidder();
      await tamper(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO bids (lot_id, bidder_id, amount_cents, placed_at, seq, prev_hash, hash)
          VALUES (${lot.id}::uuid, ${intruder.user.id}::uuid, 10000, now(), 1, ${"0".repeat(64)}, ${"f".repeat(64)})`;
      });

      expect(await audit(lot.id)).toMatchObject({ verdict: "tampered", firstBreak: { seq: 1 } });
    });
  });

  describe("open lots and the known limit", () => {
    it("catches a naively removed last bid on an open lot (lot count disagrees)", async () => {
      const { lot } = await openLot();
      await tamper((tx) => tx.$executeRaw`DELETE FROM bids WHERE lot_id = ${lot.id}::uuid AND seq = 3`);

      expect(await audit(lot.id)).toMatchObject({
        verdict: "tampered",
        sealed: false,
        firstBreak: { reason: "BID_COUNT_MISMATCH" },
      });
    });

    it("KNOWN LIMIT: removing the last bid AND rewriting the lot columns is NOT detectable while the lot is open", async () => {
      // Sem selo e sem âncora externa, o estado resultante é uma cadeia
      // perfeitamente válida de 2 lances. Documentado no README: só lotes
      // encerrados têm essa proteção (selo + comprovante). Este teste existe para
      // que o limite fique escrito em código, e não escondido.
      const { lot, b } = await openLot();
      await tamper(async (tx) => {
        await tx.$executeRaw`DELETE FROM bids WHERE lot_id = ${lot.id}::uuid AND seq = 3`;
        await tx.$executeRaw`UPDATE lots SET bid_count = 2, current_bid_cents = 11000, leader_id = ${b.user.id}::uuid WHERE id = ${lot.id}::uuid`;
      });

      expect(await audit(lot.id)).toMatchObject({ verdict: "intact", sealed: false, checkedBids: 2 });
    });
  });

  describe("defense in depth: append-only triggers", () => {
    it("blocks UPDATE and DELETE on bids, wallet_entries and receipts without special privileges", async () => {
      const { lot, a } = await closedLot();

      await expect(prisma.$executeRaw`UPDATE bids SET amount_cents = 1 WHERE lot_id = ${lot.id}::uuid`).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`DELETE FROM bids WHERE lot_id = ${lot.id}::uuid`).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`UPDATE wallet_entries SET amount_cents = 1 WHERE user_id = ${a.user.id}::uuid`).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`DELETE FROM wallet_entries WHERE user_id = ${a.user.id}::uuid`).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`UPDATE receipts SET amount_cents = 1 WHERE lot_id = ${lot.id}::uuid`).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`DELETE FROM receipts WHERE lot_id = ${lot.id}::uuid`).rejects.toThrow(/append-only/);

      // Nada mudou: o veredito segue íntegro.
      expect(await audit(lot.id)).toMatchObject({ verdict: "intact" });
    });
  });

  describe("external API outage", () => {
    it("audit, lot read and bid history work with every outbound fetch failing", async () => {
      const { lot } = await closedLot();
      const fetchMock = vi.fn(() => Promise.reject(new Error("external API is down")));
      vi.stubGlobal("fetch", fetchMock);
      try {
        expect(await audit(lot.id)).toMatchObject({ verdict: "intact" });
        const lotResponse = await app.inject({ method: "GET", url: `/lots/${lot.id}` });
        expect(lotResponse.statusCode).toBe(200);
        const bidsResponse = await app.inject({ method: "GET", url: `/lots/${lot.id}/bids` });
        expect(bidsResponse.statusCode).toBe(200);
        // Nenhuma dessas rotas sequer tenta falar com a rede.
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
