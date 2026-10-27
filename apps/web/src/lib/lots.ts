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

export type ArtworkFact = { label: string; value: string };

// "Ficha da obra" da sala do lote: o que o snapshot do museu guardou, na ordem em que se
// lê uma ficha técnica. Linhas sem valor somem (o museu nem sempre preenche tudo). O artista
// aparece completo (nacionalidade e anos); o título da página só mostra a primeira linha.
export function artworkFacts(lot: Pick<Lot, "attributes">): ArtworkFact[] {
  const a = lot.attributes;
  const publicDomain = a.is_public_domain === undefined ? "" : a.is_public_domain ? "Sim" : "Não";
  const facts: ArtworkFact[] = [
    { label: "Artista", value: a.artist_display ?? "" },
    { label: "Data", value: a.date_display ?? "" },
    { label: "Técnica", value: a.medium_display ?? "" },
    { label: "Dimensões", value: a.dimensions ?? "" },
    { label: "Crédito", value: a.credit_line ?? "" },
    { label: "Referência no acervo", value: a.main_reference_number ?? "" },
    { label: "Domínio público", value: publicDomain },
  ];
  return facts.map((fact) => ({ ...fact, value: fact.value.trim() })).filter((fact) => fact.value !== "");
}
