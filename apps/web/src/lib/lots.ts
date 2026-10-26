import type { Lot } from "../api/lots";

export type SortKey = "default" | "highest" | "most-bids";

// O servidor já devolve cada fase na ordem natural (ao vivo: quem termina primeiro;
// agendados: quem abre primeiro; encerrados: mais recentes). Aqui só se reordena o
// que já foi buscado (até 50 lotes), sem nova chamada.
export function sortLots(lots: Lot[], sort: SortKey): Lot[] {
  if (sort === "default") return lots;
  const value = (lot: Lot) => (lot.finalPriceCents ?? lot.currentBidCents ?? lot.startingBidCents);
  const copy = [...lots];
  if (sort === "highest") return copy.sort((a, b) => value(b) - value(a));
  return copy.sort((a, b) => b.bidCount - a.bidCount);
}

// Obra em destaque do herói: o lote ao vivo mais disputado (mais lances); empate,
// o que termina primeiro. Prefere lotes com imagem, para o herói não ficar vazio.
export function pickFeatured(liveLots: Lot[]): Lot | null {
  const withImage = liveLots.filter((lot) => lot.imageUrl);
  const pool = withImage.length > 0 ? withImage : liveLots;
  let best: Lot | null = null;
  for (const lot of pool) {
    if (
      !best ||
      lot.bidCount > best.bidCount ||
      (lot.bidCount === best.bidCount && Date.parse(lot.endsAt) < Date.parse(best.endsAt))
    ) {
      best = lot;
    }
  }
  return best;
}
