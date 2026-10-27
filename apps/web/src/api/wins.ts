import { apiFetch } from "./client";

// Espelha GET /me/wins (apps/api/src/modules/me/routes.ts). Só aparecem lotes JÁ
// liquidados: a liquidação (débito, crédito e comprovante) acontece numa única
// transação, então não existe "arrematado mas sem comprovante".
export type Win = {
  receiptToken: string;
  lotId: string;
  title: string;
  imageUrl: string | null;
  amountCents: number;
  issuedAt: string;
};

export const winsQueryKey = ["wins"] as const;

export async function fetchWins(): Promise<Win[]> {
  const { wins } = await apiFetch<{ wins: Win[] }>("/me/wins");
  return wins;
}
