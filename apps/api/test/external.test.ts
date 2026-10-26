import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";
import { resetExternalState, searchArtworks } from "../src/modules/external/artic.js";
import { authHeader, createUser, tokenFor } from "./helpers.js";

// Payload no formato real da API do museu (/artworks/search com `fields`).
const artic = (rows: unknown[]) => new Response(JSON.stringify({ data: rows }), { status: 200 });

const seurat = {
  id: 27992,
  title: "A Sunday on La Grande Jatte — 1884",
  image_id: "2d484387-2509-5e8e-2c43-22f9981972eb",
  is_public_domain: true,
  artist_display: "Georges Seurat (French, 1859–1891)",
  date_display: "1884–86",
  medium_display: "Oil on canvas",
  dimensions: "207.5 × 308.1 cm",
  credit_line: "Helen Birch Bartlett Memorial Collection",
  main_reference_number: "1926.224",
};

describe("GET /external/artworks", () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    token = tokenFor(app, await createUser("auctioneer"));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Estado em memória (cache e cooldown) é por processo: zera entre os testes.
  beforeEach(() => resetExternalState());
  afterEach(() => vi.unstubAllGlobals());

  function search(query: string, auth: Record<string, string> = authHeader(token)) {
    return app.inject({ method: "GET", url: `/external/artworks?${query}`, headers: auth });
  }

  describe("when the museum API answers", () => {
    it("maps the catalog to the lot snapshot shape and builds the IIIF image URL", async () => {
      const fetchMock = vi.fn(async () => artic([seurat]));
      vi.stubGlobal("fetch", fetchMock);

      const response = await search("q=Grande Jatte");

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ source: "artic", degraded: false, reason: null, message: null });
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toEqual({
        externalId: "27992",
        title: "A Sunday on La Grande Jatte — 1884",
        imageUrl: "https://www.artic.edu/iiif/2/2d484387-2509-5e8e-2c43-22f9981972eb/full/843,/0/default.jpg",
        artistDisplay: "Georges Seurat (French, 1859–1891)",
        dateDisplay: "1884–86",
        mediumDisplay: "Oil on canvas",
        isPublicDomain: true,
        attributes: {
          artist_display: "Georges Seurat (French, 1859–1891)",
          date_display: "1884–86",
          medium_display: "Oil on canvas",
          dimensions: "207.5 × 308.1 cm",
          credit_line: "Helen Birch Bartlett Memorial Collection",
          is_public_domain: true,
          main_reference_number: "1926.224",
        },
      });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
      expect(url.origin + url.pathname).toBe("https://api.artic.edu/api/v1/artworks/search");
      expect(url.searchParams.get("q")).toBe("Grande Jatte");
      expect(url.searchParams.get("fields")).toContain("image_id");
      expect((init.headers as Record<string, string>)["user-agent"]).toContain("leilao-online");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("drops records without an image or in a broken format instead of failing the list", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => artic([seurat, { ...seurat, id: 1, image_id: null }, { id: "x" }, null, "junk"])),
      );

      const body = (await search("q=jatte")).json();

      expect(body.degraded).toBe(false);
      expect(body.items.map((item: { externalId: string }) => item.externalId)).toEqual(["27992"]);
    });

    it("answers a repeated search from the cache without calling the museum again", async () => {
      const fetchMock = vi.fn(async () => artic([seurat]));
      vi.stubGlobal("fetch", fetchMock);

      await search("q=jatte");
      const second = await search("q=JATTE");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second.json().items).toHaveLength(1);
    });

    it("produces items that can be published as a lot as they are", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => artic([seurat])));
      const [item] = (await search("q=jatte")).json().items;

      const response = await app.inject({
        method: "POST",
        url: "/lots",
        headers: authHeader(token),
        payload: {
          externalId: item.externalId,
          title: item.title,
          imageUrl: item.imageUrl,
          attributes: item.attributes,
          startingBidCents: 100_000,
          minIncrementCents: 5_000,
          startsAt: new Date(Date.now() + 3_600_000).toISOString(),
          endsAt: new Date(Date.now() + 7_200_000).toISOString(),
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().lot.attributes.artist_display).toBe("Georges Seurat (French, 1859–1891)");
    });
  });

  describe("when the museum API fails (it must never take the panel down)", () => {
    it("blocked by Cloudflare (403): degrades with the local catalog", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("challenge", { status: 403 })));

      const response = await search("q=piranesi");

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ degraded: true, source: "local", reason: "unavailable" });
      expect(body.message).toContain("unavailable");
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.every((item: { artistDisplay: string }) => /piranesi/i.test(item.artistDisplay))).toBe(true);
    });

    it("network error: still 200, degraded, and an empty list when nothing local matches", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));

      const response = await search("q=zzzzzz-no-such-artwork");

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ degraded: true, source: "local", reason: "unavailable", items: [] });
    });

    it("200 with a non-JSON body (an HTML challenge page) is treated as unavailable", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Just a moment...</html>", { status: 200 })));

      const response = await search("q=piranesi");

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ degraded: true, reason: "unavailable" });
    });

    it("gives up after the short timeout and reports it as a timeout", async () => {
      // Um fetch que nunca responde e só termina quando o sinal de timeout dispara.
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: unknown, init: RequestInit) =>
            new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
        ),
      );

      const startedAt = Date.now();
      const result = await searchArtworks("piranesi", 8, { timeoutMs: 40 });

      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(result).toMatchObject({ degraded: true, reason: "timeout", source: "local" });
    });

    it("stops calling the museum for a while after a failure, so searches stay fast", async () => {
      const fetchMock = vi.fn(async () => new Response("blocked", { status: 403 }));
      vi.stubGlobal("fetch", fetchMock);

      await search("q=piranesi");
      await search("q=meryon");
      await search("q=rosa");

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("access and validation", () => {
    it("requires an auctioneer: anonymous 401, bidder 403", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => artic([seurat])));
      const bidder = tokenFor(app, await createUser("bidder"));

      expect((await search("q=jatte", {})).statusCode).toBe(401);
      expect((await search("q=jatte", authHeader(bidder))).statusCode).toBe(403);
    });

    it("rejects a missing, too short or too long query and an out-of-range limit", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => artic([])));
      for (const query of ["", "q=", "q=a", `q=${"x".repeat(101)}`, "q=ab&limit=0", "q=ab&limit=21"]) {
        const response = await search(query);
        expect(response.statusCode, query).toBe(400);
        expect(response.json().code).toBe("VALIDATION_ERROR");
      }
    });
  });
});
