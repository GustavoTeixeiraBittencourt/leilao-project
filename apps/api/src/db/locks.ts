import { z } from "zod";
import type { DbClient } from "./client.js";

// ÚNICO lugar do projeto com SQL cru. O retorno de cada $queryRaw é validado
// com Zod (nunca `any`): se o schema do banco mudar, quebra aqui, alto e cedo.
//
// ORDEM DE LOCKS (regra do projeto, vale também para o worker de liquidação):
//   1) lote  ->  2) linha do licitante.
// Toda transação que toca os dois pega nessa ordem; como ninguém pega o lock
// do usuário antes do lote, não existe ciclo de espera e, portanto, deadlock.

const lockedLotRow = z.object({
  id: z.string().uuid(),
  auctioneer_id: z.string().uuid(),
  status: z.enum(["open", "closed", "cancelled"]),
  starting_bid_cents: z.bigint(),
  min_increment_cents: z.bigint(),
  starts_at: z.date(),
  ends_at: z.date(),
  current_bid_cents: z.bigint().nullable(),
  leader_id: z.string().uuid().nullable(),
  bid_count: z.number().int(),
});
export type LockedLot = z.infer<typeof lockedLotRow>;

// SELECT ... FOR UPDATE serializa todos os lances do mesmo lote: o segundo
// espera o commit do primeiro e então lê o estado já atualizado (Read
// Committed reavalia a linha travada), sem perder lance nem duplicar `seq`.
export async function lockLot(tx: DbClient, lotId: string): Promise<LockedLot | null> {
  const rows = await tx.$queryRaw`
    SELECT id, auctioneer_id, status, starting_bid_cents, min_increment_cents,
           starts_at, ends_at, current_bid_cents, leader_id, bid_count
    FROM lots
    WHERE id = ${lotId}::uuid
    FOR UPDATE`;
  return z.array(lockedLotRow).parse(rows)[0] ?? null;
}

const lockedBidderRow = z.object({
  id: z.string().uuid(),
  role: z.enum(["auctioneer", "bidder"]),
  public_alias: z.string(),
});
export type LockedBidder = z.infer<typeof lockedBidderRow>;

// Travar a linha do usuário serializa os lances do MESMO licitante em lotes
// DIFERENTES. Sem isso, dois lances simultâneos em lotes distintos leriam o
// mesmo "disponível" e ambos passariam, comprometendo mais que o saldo.
// O papel também vem daqui (banco), não do JWT: revalidação no servidor.
export async function lockBidder(tx: DbClient, userId: string): Promise<LockedBidder | null> {
  const rows = await tx.$queryRaw`
    SELECT id, role, public_alias
    FROM users
    WHERE id = ${userId}::uuid
    FOR UPDATE`;
  return z.array(lockedBidderRow).parse(rows)[0] ?? null;
}

const clockRow = z.object({ now: z.date() });

// Relógio do banco, lido DEPOIS dos locks. Não usar now(): ele devolve o
// início da transação, que ficaria defasado se o lance esperou na fila do lock.
// O Date do JS trunca para milissegundos, igual à coluna Timestamptz(3), então
// o valor assinado no hash é exatamente o que fica gravado.
export async function getDbNow(tx: DbClient): Promise<Date> {
  const rows = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
  return z.array(clockRow).parse(rows)[0]!.now;
}
