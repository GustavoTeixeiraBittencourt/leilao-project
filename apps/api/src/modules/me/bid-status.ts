// Situação de um lote para quem deu lance nele. Derivada, sem coluna nova:
// - aberto: `leading` se o usuário é o líder atual, senão `outbid` (ainda dá para cobrir)
// - fechado: `won` se ele é o vencedor, senão `lost`
// Lote vencido mas ainda não liquidado continua "aberto" até o worker fechar, então segue
// `leading`/`outbid` por alguns segundos: é o mesmo comportamento do resto do sistema.
export type BidderLotStatus = "leading" | "outbid" | "won" | "lost";

export function bidderLotStatus(
  lot: { status: string; leaderId: string | null; winnerId: string | null },
  userId: string,
): BidderLotStatus {
  // Cancelar exige zero lances, então não deveria acontecer; "lost" é o rótulo mais seguro.
  if (lot.status === "cancelled") return "lost";
  if (lot.status === "closed") return lot.winnerId === userId ? "won" : "lost";
  return lot.leaderId === userId ? "leading" : "outbid";
}
