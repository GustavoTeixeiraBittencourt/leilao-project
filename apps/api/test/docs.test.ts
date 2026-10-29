import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("API documentation (/docs)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the Swagger UI publicly", async () => {
    const response = await app.inject({ method: "GET", url: "/docs/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
  });

  it("serves a valid OpenAPI document listing every public route", async () => {
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    expect(response.statusCode).toBe(200);
    const spec = response.json();
    expect(spec.openapi).toMatch(/^3\./);

    const documented = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.keys(item as object).map((method) => `${method.toUpperCase()} ${path}`),
    );
    for (const route of [
      "POST /auth/signup",
      "POST /auth/login",
      "GET /wallet",
      "POST /wallet/deposit",
      "GET /lots",
      "POST /lots",
      "PATCH /lots/{id}",
      "POST /lots/{id}/cancel",
      "POST /lots/{id}/bids",
      "GET /lots/{id}/bids",
      "GET /lots/{id}/events",
      "GET /audit/lots/{id}",
      "GET /receipts/{token}",
      "GET /me/wins",
      "GET /me/bids",
      "GET /me/auctions",
      "GET /external/artworks",
    ]) {
      expect(documented).toContain(route);
    }
  });

  it("derives request bodies from the same Zod schemas the routes validate with", async () => {
    const spec = (await app.inject({ method: "GET", url: "/docs/json" })).json();
    const bidBody = spec.paths["/lots/{id}/bids"].post.requestBody.content["application/json"].schema;
    expect(bidBody.properties.amountCents).toMatchObject({ type: "integer", maximum: 100_000_000_000 });
    expect(bidBody.required).toContain("amountCents");
  });

  it("does not require a login to read the docs", async () => {
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    expect(response.statusCode).not.toBe(401);
  });
});
