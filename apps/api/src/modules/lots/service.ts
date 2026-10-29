import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { getDbNow, lockLot, searchLotIds } from "../../db/locks.js";
import { publishLotEvent } from "../../lib/events.js";
import { AppError } from "../../lib/errors.js";
import { closeIfDue } from "../settlement/service.js";
import type { CreateLotInput, ListLotsQuery, UpdateLotInput } from "./schemas.js";

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

// Cancelamento: só o dono, só de lote ainda aberto (agendado ou ao vivo) e SEM
// lances. A checagem de "sem lances" acontece sob o FOR UPDATE do lote, o mesmo
// lock que o lance usa: um lance simultâneo ou entra antes (e o cancelamento
// recebe LOT_HAS_BIDS) ou depois (e o lance recebe LOT_CLOSED). Nunca os dois.
// Sem lances não há dinheiro comprometido, então não há estorno a fazer.
export async function cancelLot(userId: string, lotId: string) {
  const result = await prisma.$transaction(
    async (tx) => {
      const lot = await lockLot(tx, lotId);
      if (!lot) throw new AppError("NOT_FOUND", "Lot not found");
      if (lot.auctioneer_id !== userId) {
        throw new AppError("FORBIDDEN", "Only the auctioneer who created this lot can cancel it");
      }

      const now = await getDbNow(tx);
      if (lot.status !== "open" || lot.ends_at <= now) {
        throw new AppError("LOT_NOT_CANCELLABLE", "Only lots that have not ended can be cancelled");
      }
      if (lot.bid_count > 0) {
        throw new AppError("LOT_HAS_BIDS", "A lot that already has bids cannot be cancelled");
      }

      return tx.lot.update({ where: { id: lotId }, data: { status: "cancelled" }, include: lotInclude });
    },
    { timeout: 10_000, maxWait: 5_000 },
  );

  // Só depois do commit; quem está na sala do lote precisa ver que ele saiu.
  publishLotEvent({ type: "lot_cancelled", lotId, serverNow: new Date().toISOString() });
  return result;
}

// Edição dos parâmetros do leilão (lance inicial, incremento, horários). Mesma regra e mesmo
// lock do cancelamento: só o dono, só lote aberto que não terminou e SEM lances. Sem lances
// não existe cadeia de hash (o genesis é criado no 1º lance, com estes parâmetros), então
// mudar aqui não afeta a auditoria. Lance simultâneo: ou entra antes (a edição recebe
// LOT_NOT_EDITABLE) ou depois (já vê os parâmetros novos).
export async function updateLot(userId: string, lotId: string, input: UpdateLotInput) {
  const result = await prisma.$transaction(
    async (tx) => {
      const lot = await lockLot(tx, lotId);
      if (!lot) throw new AppError("NOT_FOUND", "Lot not found");
      if (lot.auctioneer_id !== userId) {
        throw new AppError("FORBIDDEN", "Only the auctioneer who created this lot can edit it");
      }

      const now = await getDbNow(tx);
      if (lot.status !== "open" || lot.ends_at <= now) {
        throw new AppError("LOT_NOT_EDITABLE", "Only lots that have not ended can be edited");
      }
      if (lot.bid_count > 0) {
        throw new AppError("LOT_NOT_EDITABLE", "A lot that already has bids can no longer be edited");
      }

      const startsAt = input.startsAt ?? lot.starts_at;
      const endsAt = input.endsAt ?? lot.ends_at;
      // Lote já aberto não "volta" a agendado: o início só muda enquanto ainda não começou.
      if (input.startsAt && lot.starts_at <= now && input.startsAt.getTime() !== lot.starts_at.getTime()) {
        throw new AppError("VALIDATION_ERROR", "startsAt cannot change once the lot has started");
      }
      if (endsAt <= startsAt) throw new AppError("VALIDATION_ERROR", "endsAt must be after startsAt");
      if (endsAt <= now) throw new AppError("VALIDATION_ERROR", "endsAt must be in the future");

      return tx.lot.update({
        where: { id: lotId },
        data: {
          ...(input.startingBidCents !== undefined && { startingBidCents: BigInt(input.startingBidCents) }),
          ...(input.minIncrementCents !== undefined && { minIncrementCents: BigInt(input.minIncrementCents) }),
          startsAt,
          endsAt,
        },
        include: lotInclude,
      });
    },
    { timeout: 10_000, maxWait: 5_000 },
  );
  return result;
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
