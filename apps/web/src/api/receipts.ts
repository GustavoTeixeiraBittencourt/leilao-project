import { apiFetch } from "./client";
import type { Lot } from "./lots";

// Espelha GET /receipts/:token (apps/api/src/modules/receipts/routes.ts).
export type Receipt = {
  token: string;
  issuedAt: string;
  amountCents: number;
  winnerAlias: string;
  seal: { count: number | null; hash: string | null };
  lot: {
    id: string;
    title: string;
    imageUrl: string | null;
    attributes: Lot["attributes"];
    closedAt: string | null;
    bidCount: number;
  };
};

export const receiptQueryKey = (token: string) => ["receipt", token] as const;

export async function fetchReceipt(token: string): Promise<Receipt> {
  const { receipt } = await apiFetch<{ receipt: Receipt }>(`/receipts/${token}`);
  return receipt;
}
