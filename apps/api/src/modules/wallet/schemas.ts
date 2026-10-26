import { z } from "zod";

// Teto por operação: R$ 1.000.000,00. O depósito é simulado, mas um teto evita
// valores absurdos que estourariam Number.MAX_SAFE_INTEGER na borda da API.
export const MAX_DEPOSIT_CENTS = 100_000_000;

export const depositSchema = z.object({
  amountCents: z.number().int().positive().max(MAX_DEPOSIT_CENTS),
});
export type DepositInput = z.infer<typeof depositSchema>;
