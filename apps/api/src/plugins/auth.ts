import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";

export type JwtPayload = {
  sub: string;
  role: "auctioneer" | "bidder";
};

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: JwtPayload["role"]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function authPlugin(app: FastifyInstance) {
  await app.register(fastifyJwt, { secret: env.JWT_SECRET });

  app.decorate("authenticate", async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError("UNAUTHORIZED", "Missing or invalid authentication token");
    }
  });

  // Papel sempre revalidado no servidor a partir do token assinado — nunca
  // confiar em um papel enviado pelo cliente fora do JWT.
  app.decorate("requireRole", (role: JwtPayload["role"]) => {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      if (request.user.role !== role) {
        throw new AppError("FORBIDDEN", `This action requires the '${role}' role`);
      }
    };
  });
}

export default fp(authPlugin);
