import type { FastifyInstance } from "fastify";
import { AppError } from "../../lib/errors.js";
import { loginSchema, signupSchema } from "./schemas.js";
import { getUserById, login, signup } from "./service.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/signup", async (request, reply) => {
    const input = signupSchema.parse(request.body);
    const user = await signup(input);
    const token = app.jwt.sign({ sub: user.id, role: user.role });
    return reply.status(201).send({ token, user });
  });

  app.post("/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await login(input);
    const token = app.jwt.sign({ sub: user.id, role: user.role });
    return reply.send({ token, user });
  });

  app.get("/auth/me", { preHandler: app.authenticate }, async (request) => {
    const user = await getUserById(request.user.sub);
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found");
    }
    return { user };
  });
}
