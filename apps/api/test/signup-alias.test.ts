import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/client.js";
import { createUser } from "./helpers.js";

// O alias público tem só 4 hex (65.536 valores) e é UNIQUE. O gerador real é
// aleatório, então a colisão é forçada aqui, de forma determinística, com um
// gerador que devolve primeiro um alias já existente e depois um livre.
const aliases = vi.hoisted(() => ({ queue: [] as string[] }));

vi.mock("../src/lib/public-alias.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/public-alias.js")>();
  return {
    ...original,
    generatePublicAlias: (role: "auctioneer" | "bidder") => aliases.queue.shift() ?? original.generatePublicAlias(role),
  };
});

describe("signup alias collisions", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("retries with a new alias instead of failing with a 500", async () => {
    const existing = await createUser("bidder");
    // Alias livre ÚNICO por execução: usuários não são apagados entre execuções
    // (ledger append-only), então um alias fixo colidiria a partir da segunda vez.
    const freeAlias = `Licitante #t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    aliases.queue.push(existing.publicAlias, freeAlias);

    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: `alias-collision-${Date.now()}@example.com`,
        password: "senha12345",
        displayName: "Collision",
        role: "bidder",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.publicAlias).toBe(freeAlias);
  });
});
