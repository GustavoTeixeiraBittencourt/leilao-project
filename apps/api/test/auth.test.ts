import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";

describe("auth", () => {
  let app: FastifyInstance;
  const createdEmails: string[] = [];

  function uniqueEmail() {
    const email = `test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    return email;
  }

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await app.close();
    await prisma.$disconnect();
  });

  it("GET /health returns ok and a server clock", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(new Date(body.serverNow).getTime()).not.toBeNaN();
  });

  it("signs up a bidder, logs in and resolves /auth/me", async () => {
    const email = uniqueEmail();

    const signupResponse = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email, password: "senha12345", displayName: "Bidder Test", role: "bidder" },
    });
    expect(signupResponse.statusCode).toBe(201);
    const { token, user } = signupResponse.json();
    expect(user.role).toBe("bidder");
    expect(user.publicAlias).toMatch(/^Licitante #/);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "senha12345" },
    });
    expect(loginResponse.statusCode).toBe(200);

    const meResponse = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().user.email).toBe(email);
  });

  it("rejects duplicate email on signup", async () => {
    const email = uniqueEmail();
    const payload = { email, password: "senha12345", displayName: "Dup", role: "bidder" as const };

    await app.inject({ method: "POST", url: "/auth/signup", payload });
    const second = await app.inject({ method: "POST", url: "/auth/signup", payload });

    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("EMAIL_ALREADY_IN_USE");
  });

  it("rejects login with wrong password", async () => {
    const email = uniqueEmail();
    await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email, password: "senha12345", displayName: "Wrong Pw", role: "bidder" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "senha-errada" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects /auth/me without a token", async () => {
    const response = await app.inject({ method: "GET", url: "/auth/me" });
    expect(response.statusCode).toBe(401);
  });
});
