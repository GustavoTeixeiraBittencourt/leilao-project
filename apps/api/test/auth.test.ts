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

  // Cadastra pelo endpoint real (e não por createUser dos helpers) porque estes testes
  // precisam de um hash de senha de verdade.
  async function signupUser(password = "senha12345") {
    const email = uniqueEmail();
    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email, password, displayName: "Profile Test", role: "bidder" },
    });
    const { token, user } = response.json();
    return { email, token: token as string, user, password };
  }

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  describe("PATCH /auth/me (display name)", () => {
    it("updates the display name and keeps alias, role and e-mail", async () => {
      const { token, user, email } = await signupUser();

      const response = await app.inject({
        method: "PATCH",
        url: "/auth/me",
        headers: bearer(token),
        payload: { displayName: "  Novo Nome  " },
      });

      expect(response.statusCode).toBe(200);
      const updated = response.json().user;
      expect(updated.displayName).toBe("Novo Nome"); // aparado
      expect(updated.publicAlias).toBe(user.publicAlias); // o alias público nunca muda
      expect(updated.role).toBe("bidder");
      expect(updated.email).toBe(email);

      const me = await app.inject({ method: "GET", url: "/auth/me", headers: bearer(token) });
      expect(me.json().user.displayName).toBe("Novo Nome");
    });

    it("rejects a name that is too short, or only spaces", async () => {
      const { token } = await signupUser();
      for (const displayName of ["a", "   ", ""]) {
        const response = await app.inject({ method: "PATCH", url: "/auth/me", headers: bearer(token), payload: { displayName } });
        expect(response.statusCode).toBe(400);
        expect(response.json().code).toBe("VALIDATION_ERROR");
      }
    });

    it("requires authentication", async () => {
      const response = await app.inject({ method: "PATCH", url: "/auth/me", payload: { displayName: "Alguém" } });
      expect(response.statusCode).toBe(401);
    });

    it("ignores an attempt to change the role or alias through the body", async () => {
      const { token, user } = await signupUser();
      const response = await app.inject({
        method: "PATCH",
        url: "/auth/me",
        headers: bearer(token),
        payload: { displayName: "Nome Válido", role: "auctioneer", publicAlias: "Licitante #0000" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().user.role).toBe("bidder");
      expect(response.json().user.publicAlias).toBe(user.publicAlias);
    });
  });

  describe("POST /auth/password", () => {
    it("changes the password: the old one stops working and the new one logs in", async () => {
      const { token, email, password } = await signupUser();

      const response = await app.inject({
        method: "POST",
        url: "/auth/password",
        headers: bearer(token),
        payload: { currentPassword: password, newPassword: "outra-senha-123" },
      });
      expect(response.statusCode).toBe(204);

      const oldLogin = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
      expect(oldLogin.statusCode).toBe(401);
      const newLogin = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "outra-senha-123" } });
      expect(newLogin.statusCode).toBe(200);
    });

    it("refuses a wrong current password with a code the UI can explain, and changes nothing", async () => {
      const { token, email, password } = await signupUser();

      const response = await app.inject({
        method: "POST",
        url: "/auth/password",
        headers: bearer(token),
        payload: { currentPassword: "senha-errada", newPassword: "outra-senha-123" },
      });
      // 422 (e não 401): a pessoa está autenticada; um 401 seria lido como sessão expirada.
      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("INVALID_CURRENT_PASSWORD");

      const stillWorks = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
      expect(stillWorks.statusCode).toBe(200);
    });

    it("rejects a new password that is too short, too long (bcrypt 72 bytes) or equal to the current one", async () => {
      const { token, password } = await signupUser();
      const attempts = ["curta", "x".repeat(73), password];
      for (const newPassword of attempts) {
        const response = await app.inject({
          method: "POST",
          url: "/auth/password",
          headers: bearer(token),
          payload: { currentPassword: password, newPassword },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().code).toBe("VALIDATION_ERROR");
      }
    });

    it("requires authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/password",
        payload: { currentPassword: "senha12345", newPassword: "outra-senha-123" },
      });
      expect(response.statusCode).toBe(401);
    });
  });
});
