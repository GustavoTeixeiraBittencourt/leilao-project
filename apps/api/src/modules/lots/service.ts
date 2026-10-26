import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { searchLotIds } from "../../db/locks.js";
import { AppError } from "../../lib/errors.js";
import { closeIfDue } from "../settlement/service.js";
import type { CreateLotInput, ListLotsQuery } from "./schemas.js";

// Líder e vencedor aparecem só pelo alias pseudônimo.
const lotInclude = {
  leader: { select: { publicAlias: true } },
  winner: { select: { publicAlias: true } },
} satisfies Prisma.LotInclude;

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
    include: lotInclude,
  });
}

export async function getLot(id: string) {
  const load = () =>
    prisma.lot.findUnique({
      where: { id },
      include: lotInclude,
    });

  let lot = await load();
  if (!lot) {
    throw new AppError("NOT_FOUND", "Lot not found");
  }
  // Fechamento preguiçoso: se o worker não passou ainda (ou está parado), esta
  // leitura liquida o lote vencido e devolve o estado já encerrado.
  if (await closeIfDue(lot)) {
    lot = (await load()) ?? lot;
  }
  return lot;
}

type Phase = NonNullable<ListLotsQuery["phase"]>;

// Fases derivadas do horário (o banco só tem open/closed/cancelled). Lote
// cancelado fica de fora de TODAS: nunca aparece na vitrine nem nas contagens.
// A fase "ended" inclui open com ends_at vencido (o worker ainda não liquidou).
function phaseWhere(phase: Phase, now: Date): Prisma.LotWhereInput {
  switch (phase) {
    case "live":
      return { status: "open", startsAt: { lte: now }, endsAt: { gt: now } };
    case "scheduled":
      return { status: "open", startsAt: { gt: now } };
    case "ended":
      return { OR: [{ status: "closed" }, { status: "open", endsAt: { lte: now } }] };
  }
}

const PHASE_ORDER: Record<Phase, Prisma.LotOrderByWithRelationInput[]> = {
  live: [{ endsAt: "asc" }, { id: "asc" }], // o que termina primeiro, primeiro
  scheduled: [{ startsAt: "asc" }, { id: "asc" }],
  ended: [{ endsAt: "desc" }, { id: "desc" }], // mais recentes primeiro
};

// Busca por título ou artista: os ids vêm de searchLotIds (SQL cru em
// db/locks.ts, insensível a caixa e sem curingas) e o resto segue em Prisma.
// A tabela é pequena nesta simulação; num catálogo grande isto viraria uma
// coluna de busca indexada (tsvector/trigram).
async function searchWhere(q: string | undefined): Promise<Prisma.LotWhereInput> {
  if (!q) return {};
  return { id: { in: await searchLotIds(prisma, q) } };
}

// Sem fechamento preguiçoso aqui (decisão registrada): uma leitura em massa
// não deve disparar várias liquidações; a fase "ended" já é derivada do horário.
export async function listLots(query: ListLotsQuery, now: Date = new Date()) {
  const search = await searchWhere(query.q);
  const phases: Phase[] = ["live", "scheduled", "ended"];

  const [counts, lots] = await Promise.all([
    Promise.all(phases.map((phase) => prisma.lot.count({ where: { AND: [phaseWhere(phase, now), search] } }))),
    query.phase
      ? prisma.lot.findMany({
          where: { AND: [phaseWhere(query.phase, now), search] },
          orderBy: PHASE_ORDER[query.phase],
          take: query.limit,
          include: lotInclude,
        })
      : Promise.resolve([]),
  ]);

  return {
    lots,
    counts: { live: counts[0]!, scheduled: counts[1]!, ended: counts[2]! },
  };
}
