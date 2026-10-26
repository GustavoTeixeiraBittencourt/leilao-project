import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../../db/client.js";
import { AppError } from "../../lib/errors.js";
import { normalizeEmail } from "../../lib/email.js";
import { generatePublicAlias } from "../../lib/public-alias.js";
import type { LoginInput, SignupInput } from "./schemas.js";

const PASSWORD_HASH_ROUNDS = 10;
const MAX_ALIAS_ATTEMPTS = 5;

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  role: "auctioneer" | "bidder";
  publicAlias: string;
};

function toAuthenticatedUser(user: {
  id: string;
  email: string;
  displayName: string;
  role: "auctioneer" | "bidder";
  publicAlias: string;
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    publicAlias: user.publicAlias,
  };
}

export async function signup(input: SignupInput): Promise<AuthenticatedUser> {
  const email = normalizeEmail(input.email);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError("EMAIL_ALREADY_IN_USE", "This email is already registered");
  }

  const passwordHash = await bcrypt.hash(input.password, PASSWORD_HASH_ROUNDS);

  // O alias tem só 4 hex (65.536 valores) e é UNIQUE: com o tempo colide. Em vez
  // de devolver 500, sorteia outro. Uma colisão de e-mail aqui só acontece numa
  // corrida entre dois cadastros iguais (a checagem acima já passou).
  for (let attempt = 1; ; attempt++) {
    try {
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          role: input.role,
          displayName: input.displayName,
          publicAlias: generatePublicAlias(input.role),
        },
      });
      return toAuthenticatedUser(user);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const target = String(error.meta?.target ?? "");
      if (target.includes("email")) {
        throw new AppError("EMAIL_ALREADY_IN_USE", "This email is already registered");
      }
      if (!target.includes("public_alias") || attempt >= MAX_ALIAS_ATTEMPTS) throw error;
    }
  }
}

export async function login(input: LoginInput): Promise<AuthenticatedUser> {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password");
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password");
  }

  return toAuthenticatedUser(user);
}

export async function getUserById(id: string): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toAuthenticatedUser(user) : null;
}
