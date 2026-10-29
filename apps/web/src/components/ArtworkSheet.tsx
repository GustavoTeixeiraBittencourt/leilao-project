import type { Lot } from "../api/lots";
import { artworkFacts } from "../lib/lots";
import "./ArtworkSheet.css";

// Ficha da obra: o snapshot do museu guardado no lote (ver `artworkFacts`). Sem nenhum dado, a seção some.
// Compartilhada entre a sala do lote e a edição do leiloeiro, para a obra aparecer igual nas duas.
export function ArtworkSheet({ lot }: { lot: Pick<Lot, "attributes"> }) {
  const facts = artworkFacts(lot);
  if (facts.length === 0) return null;
  return (
    <section className="sheet" aria-labelledby="sheet-title">
      <h2 id="sheet-title" className="t-h2">
        Ficha da obra
      </h2>
      <dl className="attributes">
        {facts.map((fact) => (
          <div key={fact.label} className="attributes__row">
            <dt className="t-label-m text-secondary">{fact.label}</dt>
            <dd className="t-body-m">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
