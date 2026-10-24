import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Reaplicar o módulo em dev (tsx watch) recriaria o pool de conexões a cada
// reload; manter a instância em globalThis evita esgotar conexões do Postgres.
export const prisma = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
