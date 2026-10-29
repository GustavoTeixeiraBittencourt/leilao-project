import { z } from "zod";

// Lance e incremento em centavos inteiros (nunca float). Teto igual ao do
// depósito: um lance maior que isso nunca caberia em nenhuma carteira.
const cents = z.number().int().positive().max(100_000_000_000);

export const createLotSchema = z
  .object({
    externalId: z.string().min(1).max(64),
    title: z.string().min(1).max(300),
    // A imagem nunca passa pelo nosso backend: só a URL IIIF é guardada e o
    // <img> é carregado pelo browser do usuário (ver CLAUDE.md seção 6).
    imageUrl: z.string().url().startsWith("https://").max(500).optional(),
    // Snapshot do item da API externa; opaco para o backend.
    attributes: z.record(z.string(), z.unknown()).default({}),
    startingBidCents: cents,
    minIncrementCents: cents,
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((lot) => lot.endsAt > lot.startsAt, {
    path: ["endsAt"],
    message: "endsAt must be after startsAt",
  });
export type CreateLotInput = z.infer<typeof createLotSchema>;

// Edição: só os parâmetros do leilão (título, imagem e atributos são o snapshot da obra e
// não mudam). Todos opcionais, mas pelo menos um.
export const updateLotSchema = z
  .object({
    startingBidCents: cents.optional(),
    minIncrementCents: cents.optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one field to update",
  });
export type UpdateLotInput = z.infer<typeof updateLotSchema>;

export const lotParamsSchema = z.object({ id: z.string().uuid() });

// Fase é derivada do horário, não existe no banco (ver lotPhase em dto.ts).
// "cancelled" não é uma opção: lote cancelado nunca aparece na vitrine.
export const listLotsQuerySchema = z.object({
  phase: z.enum(["live", "scheduled", "ended"]).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListLotsQuery = z.infer<typeof listLotsQuerySchema>;
