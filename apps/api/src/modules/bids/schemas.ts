import { z } from "zod";

export const placeBidSchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000_000),
});
export type PlaceBidInput = z.infer<typeof placeBidSchema>;
