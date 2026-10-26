import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { settleLot } from "../src/modules/settlement/service.js";
import { authHeader, createLotRow, createUser, fund, tokenFor } from "./helpers.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("GET /lots (vitrine)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // O banco de dev tem lotes de outros testes. Cada teste usa um token único no
  // título e filtra por ele (q), então só enxerga os lotes que ele mesmo criou.
  const newToken = () => `zz${randomUUID().slice(0, 8)}`;

  async function list(q: string, phase?: string, extra = "") {
    const phaseParam = phase ? `&phase=${phase}` : "";
    const response = await app.inject({ method: "GET", url: `/lots?q=${encodeURIComponent(q)}${phaseParam}${extra}` });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  // Um lote em cada situação: ao vivo, agendado, encerrado (closed), vencido
  // aguardando o worker (open + ends_at no passado) e cancelado.
  async function lotsInEveryPhase(token: string) {
    const auctioneer = await createUser("auctioneer");
    const make = (name: string, options: Partial<Parameters<typeof createLotRow>[0]> = {}) =>
      createLotRow({ auctioneerId: auctioneer.id, title: `${token} ${name}`, ...options });

    const live = await make("live");
    const scheduled = await make("scheduled", { startsInMs: 2 * HOUR, endsInMs: 3 * HOUR });
    const closed = await make("closed", { startsInMs: -3 * HOUR, endsInMs: -2 * HOUR });
    await settleLot(closed.id);
    const overdue = await make("overdue", { startsInMs: -3 * HOUR, endsInMs: -1_000 });
    const cancelled = await make("cancelled");
    await prisma.lot.update({ where: { id: cancelled.id }, data: { status: "cancelled" } });
    return { auctioneer, live, scheduled, closed, overdue, cancelled };
  }

  it("is public and classifies lots by phase from the server clock", async () => {
    const token = newToken();
    const { live, scheduled, closed, overdue } = await lotsInEveryPhase(token);

    const liveList = await list(token, "live");
    const scheduledList = await list(token, "scheduled");
    const endedList = await list(token, "ended");

    expect(liveList.lots.map((l: { id: string }) => l.id)).toEqual([live.id]);
    expect(scheduledList.lots.map((l: { id: string }) => l.id)).toEqual([scheduled.id]);
    expect(endedList.lots.map((l: { id: string }) => l.id).sort()).toEqual([closed.id, overdue.id].sort());
    expect(liveList.lots[0].phase).toBe("live");
    expect(scheduledList.lots[0].phase).toBe("scheduled");
    expect(endedList.lots.every((l: { phase: string }) => l.phase === "ended")).toBe(true);
    expect(new Date(liveList.serverNow).getTime()).not.toBeNaN();
  });

  it("never shows a cancelled lot, in any phase or in the counts", async () => {
    const token = newToken();
    const { cancelled } = await lotsInEveryPhase(token);

    const all = await Promise.all(["live", "scheduled", "ended"].map((phase) => list(token, phase)));

    const ids = all.flatMap((body) => body.lots.map((l: { id: string }) => l.id));
    expect(ids).not.toContain(cancelled.id);
    expect(all[0].counts).toEqual({ live: 1, scheduled: 1, ended: 2 }); // 4 de 5: o cancelado não conta
  });

  it("returns only the counts per phase when no phase is requested", async () => {
    const token = newToken();
    await lotsInEveryPhase(token);

    const body = await list(token);

    expect(body.lots).toEqual([]);
    expect(body.counts).toEqual({ live: 1, scheduled: 1, ended: 2 });
  });

  it("orders live by soonest end, scheduled by soonest start and ended by most recent", async () => {
    const token = newToken();
    const auctioneer = await createUser("auctioneer");
    const make = (name: string, startsInMs: number, endsInMs: number) =>
      createLotRow({ auctioneerId: auctioneer.id, title: `${token} ${name}`, startsInMs, endsInMs });
    const liveLate = await make("live-late", -HOUR, 5 * HOUR);
    const liveSoon = await make("live-soon", -HOUR, 1 * HOUR);
    const schedLate = await make("sched-late", 6 * HOUR, 8 * HOUR);
    const schedSoon = await make("sched-soon", 2 * HOUR, 8 * HOUR);
    const endedOld = await make("ended-old", -9 * HOUR, -8 * HOUR);
    const endedNew = await make("ended-new", -9 * HOUR, -2 * HOUR);

    const ids = async (phase: string) => (await list(token, phase)).lots.map((l: { id: string }) => l.id);

    expect(await ids("live")).toEqual([liveSoon.id, liveLate.id]);
    expect(await ids("scheduled")).toEqual([schedSoon.id, schedLate.id]);
    expect(await ids("ended")).toEqual([endedNew.id, endedOld.id]);
  });

  it("honors limit while the counts keep the full totals", async () => {
    const token = newToken();
    const auctioneer = await createUser("auctioneer");
    for (let i = 0; i < 5; i++) await createLotRow({ auctioneerId: auctioneer.id, title: `${token} ${i}` });

    const body = await list(token, "live", "&limit=2");

    expect(body.lots).toHaveLength(2);
    expect(body.counts.live).toBe(5);
  });

  it("searches by title and by artist, case-insensitively", async () => {
    const token = newToken();
    const auctioneer = await createUser("auctioneer");
    const byTitle = await createLotRow({ auctioneerId: auctioneer.id, title: `${token} Water Lilies` });
    const byArtist = await createLotRow({
      auctioneerId: auctioneer.id,
      title: "Untitled",
      attributes: { artist_display: `Claude Monet ${token}` },
    });
    await createLotRow({ auctioneerId: auctioneer.id, title: "Unrelated" });

    const title = await list(`${token.toUpperCase()} water`, "live");
    const artist = await list(`monet ${token}`, "live");

    expect(title.lots.map((l: { id: string }) => l.id)).toEqual([byTitle.id]);
    expect(artist.lots.map((l: { id: string }) => l.id)).toEqual([byArtist.id]);
  });

  it("exposes the result of closed lots by alias only", async () => {
    const token = newToken();
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id, title: `${token} sold` });
    const winner = await createUser("bidder");
    await fund(winner.id, 100_000);
    const bidResponse = await app.inject({
      method: "POST",
      url: `/lots/${lot.id}/bids`,
      headers: authHeader(tokenFor(app, winner)),
      payload: { amountCents: 25_000 },
    });
    expect(bidResponse.statusCode).toBe(201);
    await prisma.lot.update({ where: { id: lot.id }, data: { endsAt: new Date(Date.now() - 1_000) } });
    await settleLot(lot.id);

    const response = await app.inject({ method: "GET", url: `/lots?q=${token}&phase=ended` });

    const [item] = response.json().lots;
    expect(item).toMatchObject({ id: lot.id, winnerAlias: winner.publicAlias, finalPriceCents: 25_000, bidCount: 1 });
    expect(response.body).not.toContain(winner.email);
    expect(response.body).not.toContain(auctioneer.email);
  });

  it("rejects an unknown phase, a phase of 'cancelled' and an out-of-range limit", async () => {
    for (const query of ["phase=cancelled", "phase=nope", "limit=0", "limit=51", "limit=abc"]) {
      const response = await app.inject({ method: "GET", url: `/lots?${query}` });
      expect(response.statusCode, query).toBe(400);
      expect(response.json().code).toBe("VALIDATION_ERROR");
    }
  });

  it("treats LIKE wildcards in the search as plain text", async () => {
    const token = newToken();
    const auctioneer = await createUser("auctioneer");
    await createLotRow({ auctioneerId: auctioneer.id, title: `${token} plain` });

    // "%" e "_" não podem virar curinga: "<token>%" e "<token>_plain" não existem
    // como texto literal em nenhum título, mas casariam o lote se fossem curingas.
    expect((await list(`${token}%`, "live")).lots).toHaveLength(0);
    expect((await list(`${token}_plain`, "live")).lots).toHaveLength(0);
  });
});
