import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// O env é lido uma vez no import, então a variável é definida ANTES do import
// dinâmico. Cada arquivo de teste tem seu próprio módulo, sem vazar para os demais.
describe("CORS_ORIGIN normalization", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.CORS_ORIGIN = "  https://app.example.com/  ";
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers the browser's exact origin even when the env var has a trailing slash and spaces", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/auth/login",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.com");
  });
});
