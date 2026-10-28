import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { bidderLotStatus } from "../src/modules/me/bid-status.js";
import { settleLot } from "../src/modules/settlement/service.js";
import { authHeader, createLotRow, createUser, fund, tokenFor } from "./helpers.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("bidderLotStatus", () => {
  const me = "user-me";
  const other = "user-other";

  it("is leading or outbid while the lot is open, depending on who leads", () => {
    expect(bidderLotStatus({ status: "open", leaderId: me, winnerId: null }, me)).toBe("leading");
    expect(bidderLotStatus({ status: "open", leaderId: other, winnerId: null }, me)).toBe("outbid");
  });

  it("is won or lost once the lot is closed, depending on who won", () => {
    expect(bidderLotStatus({ status: "closed", leaderId: me, winnerId: me }, me)).toBe("won");
    expect(bidderLotStatus({ status: "closed", leaderId: other, winnerId: other }, me)).toBe("lost");
  });

  it("never reports a cancelled lot as won or leading", () => {
    expect(bidderLotStatus({ status: "cancelled", leaderId: me, winnerId: null }, me)).toBe("lost");
  });
});

describe("GET /me/bids", () => {
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

  const bid = (token: string, lotId: string, amountCents: number) =>
    app.inject({ method: "POST", url: `/lots/${lotId}/bids`, headers: authHeader(token), payload: { amountCents } });

  const myBids = async (token: string) => {
    const response = await app.inject({ method: "GET", url: "/me/bids", headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    return response.json().bids as Array<Record<string, any>>;
  };

  async function closeLot(lotId: string) {
    await prisma.lot.update({ where: { id: lotId }, data: { endsAt: new Date(Date.now() - 1_000) } });
    await settleLot(lotId);
  }

  it("shows a lot I lead while it is live, with no receipt", async () => {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id, title: "Vale of Kashmir" });
    const me = await newBidder();
    await bid(me.token, lot.id, 10_000);

    const [item, ...rest] = await myBids(me.token);

    expect(rest).toHaveLength(0);
    expect(item).toMatchObject({
      lotId: lot.id,
      title: "Vale of Kashmir",
      phase: "live",
      status: "leading",
      myHighestBidCents: 10_000,
      myBidCount: 1,
      currentBidCents: 10_000,
      receiptToken: null,
      issuedAt: null,
    });
  });

  it("turns into outbid when someone covers me, and keeps showing my own highest bid", async () => {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id });
    const me = await newBidder();
    const rival = await newBidder();
    await bid(me.token, lot.id, 10_000);
    await bid(rival.token, lot.id, 12_000);

    const [item] = await myBids(me.token);

    expect(item).toMatchObject({ status: "outbid", myHighestBidCents: 10_000, currentBidCents: 12_000, receiptToken: null });
  });

  it("is won after settlement, with the receipt token and the final price", async () => {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id });
    const me = await newBidder();
    await bid(me.token, lot.id, 10_000);
    await closeLot(lot.id);

    const [item] = await myBids(me.token);
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { lotId: lot.id } });

    expect(item).toMatchObject({ status: "won", phase: "ended", currentBidCents: 10_000 });
    expect(item!.receiptToken).toBe(receipt.publicToken);
    expect(new Date(item!.issuedAt).getTime()).not.toBeNaN();
  });

  it("is lost when someone else wins, and never leaks the winner's receipt", async () => {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id });
    const me = await newBidder();
    const rival = await newBidder();
    await bid(me.token, lot.id, 10_000);
    await bid(rival.token, lot.id, 12_000);
    await closeLot(lot.id);

    const [item] = await myBids(me.token);

    expect(item).toMatchObject({ status: "lost", phase: "ended", myHighestBidCents: 10_000, currentBidCents: 12_000 });
    expect(item!.receiptToken).toBeNull();
    expect(item!.issuedAt).toBeNull();
  });

  it("groups several bids on the same lot into one item", async () => {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id });
    const me = await newBidder();
    const rival = await newBidder();
    await bid(me.token, lot.id, 10_000);
    await bid(rival.token, lot.id, 12_000);
    await bid(me.token, lot.id, 14_000);

    const items = await myBids(me.token);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: "leading", myBidCount: 2, myHighestBidCents: 14_000, currentBidCents: 14_000 });
  });

  it("orders lots by my most recent bid, newest first", async () => {
    const auctioneer = await createUser("auctioneer");
    const first = await createLotRow({ auctioneerId: auctioneer.id });
    const second = await createLotRow({ auctioneerId: auctioneer.id });
    const me = await newBidder();
    const rival = await newBidder();
    await bid(me.token, first.id, 10_000);
    await tick();
    await bid(me.token, second.id, 10_000);
    await tick();
    await bid(rival.token, first.id, 12_000);
    await tick();
    await bid(me.token, first.id, 14_000); // volta a cobrir o primeiro: agora ele é o mais recente

    const items = await myBids(me.token);

    expect(items.map((item) => item.lotId)).toEqual([first.id, second.id]);
  });

  it("only lists lots I bid on and never exposes other people's data", async () => {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id });
    const bidder = await newBidder();
    const bystander = await newBidder();
    await bid(bidder.token, lot.id, 10_000);

    expect(await myBids(bystander.token)).toEqual([]);
    const [item] = await myBids(bidder.token);
    // Nada de alias, e-mail ou id de outra pessoa na resposta.
    expect(JSON.stringify(item)).not.toContain(bystander.user.publicAlias);
    expect(JSON.stringify(item)).not.toContain(bystander.user.email);
  });

  it("is bidder-only and requires authentication", async () => {
    const auctioneer = await createUser("auctioneer");

    const asAuctioneer = await app.inject({ method: "GET", url: "/me/bids", headers: authHeader(tokenFor(app, auctioneer)) });
    expect(asAuctioneer.statusCode).toBe(403);

    const anonymous = await app.inject({ method: "GET", url: "/me/bids" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("does not change the balance or the ledger", async () => {
    const auctioneer = await createUser("auctioneer");
    const lot = await createLotRow({ auctioneerId: auctioneer.id });
    const me = await newBidder();
    await bid(me.token, lot.id, 10_000);
    const before = await prisma.walletEntry.count({ where: { userId: me.user.id } });

    await myBids(me.token);
    await myBids(me.token);

    expect(await prisma.walletEntry.count({ where: { userId: me.user.id } })).toBe(before);
  });
});
