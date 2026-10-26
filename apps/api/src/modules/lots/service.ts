import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { AppError } from "../../lib/errors.js";
import type { CreateLotInput } from "./schemas.js";

export async function createLot(auctioneerId: string, input: CreateLotInput) {
  if (input.endsAt <= new Date()) {
    throw new AppError("VALIDATION_ERROR", "endsAt must be in the future");
  }

  return prisma.lot.create({
    data: {
      auctioneerId,
      externalId: input.externalId,
      title: input.title,
      imageUrl: input.imageUrl ?? null,
      attributes: input.attributes as Prisma.InputJsonObject,
      startingBidCents: BigInt(input.startingBidCents),
      minIncrementCents: BigInt(input.minIncrementCents),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    },
    include: { leader: { select: { publicAlias: true } } },
  });
}

export async function getLot(id: string) {
  const lot = await prisma.lot.findUnique({
    where: { id },
    include: { leader: { select: { publicAlias: true } } },
  });
  if (!lot) {
    throw new AppError("NOT_FOUND", "Lot not found");
  }
  return lot;
}
