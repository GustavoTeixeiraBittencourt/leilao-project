import bcrypt from "bcryptjs";
import { prisma } from "../../db/client.js";
import { AppError } from "../../lib/errors.js";
import { normalizeEmail } from "../../lib/email.js";
import { generatePublicAlias } from "../../lib/public-alias.js";
import type { LoginInput, SignupInput } from "./schemas.js";

const PASSWORD_HASH_ROUNDS = 10;

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
