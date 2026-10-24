import { randomBytes } from "node:crypto";

// Alias pseudônimo estável usado na auditoria pública e no comprovante —
// nunca o nome/e-mail real do usuário. Ex.: "Licitante #a3f9".
export function generatePublicAlias(role: "auctioneer" | "bidder"): string {
  const label = role === "bidder" ? "Licitante" : "Leiloeiro";
  const suffix = randomBytes(2).toString("hex");
  return `${label} #${suffix}`;
}
