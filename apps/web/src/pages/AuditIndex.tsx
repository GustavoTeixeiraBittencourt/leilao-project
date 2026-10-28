import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { fetchLots, lotsQueryKey, type ListedPhase, type Lot } from "../api/lots";
import { pageRangeLabel, paginate } from "../lib/audit";
import { describeError } from "../lib/errors";
import { bidsLabel, formatDayAt, formatMoney, lotCode } from "../lib/format";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import "./AuditIndex.css";

// A API não tem offset: busca até o teto (50) e a lista é paginada no cliente, 5 por página
// (setas < >), para a página não ficar extensa.
const LIMIT = 50;
const PAGE_SIZE = 5;

function LotRow({ lot }: { lot: Lot }) {
  const price = lot.finalPriceCents ?? lot.currentBidCents;
  return (
    <li>
      <Link to={`/audit/${lot.id}`} className="audit-lot">
        <div className="audit-lot__main">
          <span className="t-overline text-secondary">Lote nº {lotCode(lot.id)}</span>
          <span className="t-label-m audit-lot__title">{lot.title}</span>
          <span className="t-body-s text-secondary">
            {bidsLabel(lot.bidCount)}
            {price !== null && ` · ${formatMoney(price)}`}
            {` · ${lot.phase === "ended" ? "encerrou" : "termina"} ${formatDayAt(lot.endsAt)}`}
          </span>
        </div>
        <StatusBadge phase={lot.phase} />
        <span className="audit-lot__go t-label-m" aria-hidden="true">
          Auditar →
        </span>
      </Link>
    </li>
  );
}

function Section({ phase, title }: { phase: ListedPhase; title: string }) {
  const query = useQuery({ queryKey: lotsQueryKey(phase, "", LIMIT), queryFn: () => fetchLots({ phase, limit: LIMIT }) });
  const [page, setPage] = useState(1);

  const lots = query.data?.lots ?? [];
  // A página é ajustada se a lista encolher num refetch (nunca mostra uma página vazia).
  const window = paginate(page, lots.length, PAGE_SIZE);
  const listId = `audit-list-${phase}`;

  return (
    <section className="audit-index__section" aria-labelledby={`audit-${phase}`}>
      <div className="audit-index__section-head">
        <h2 id={`audit-${phase}`} className="t-h2">
          {title}
        </h2>
        {window.pageCount > 1 && (
          <nav className="audit-index__pager" aria-label={`Páginas de lotes: ${title}`}>
            <Button
              variant="secondary"
              size="sm"
              className="audit-index__arrow"
              aria-label="Página anterior"
              aria-controls={listId}
              disabled={!window.canPrev}
              onClick={() => setPage(window.page - 1)}
            >
              <span aria-hidden="true">&lt;</span>
            </Button>
            <span className="t-label-s text-secondary num" role="status">
              {pageRangeLabel(window, lots.length)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="audit-index__arrow"
              aria-label="Próxima página"
              aria-controls={listId}
              disabled={!window.canNext}
              onClick={() => setPage(window.page + 1)}
            >
              <span aria-hidden="true">&gt;</span>
            </Button>
          </nav>
        )}
      </div>
      {query.isPending ? (
        <Skeleton style={{ height: 96 }} />
      ) : query.isError ? (
        <ErrorState title="Não foi possível carregar" onRetry={() => void query.refetch()}>
          {describeError(query.error)}
        </ErrorState>
      ) : lots.length === 0 ? (
        <EmptyState title="Nenhum lote por aqui" />
      ) : (
        <ul className="audit-index__list" id={listId}>
          {lots.slice(window.start, window.end).map((lot) => (
            <LotRow key={lot.id} lot={lot} />
          ))}
        </ul>
      )}
    </section>
  );
}

// Porta de entrada da auditoria pública (sem login): a pessoa escolhe um lote e vê o
// histórico completo com o veredito íntegro/adulterado.
export function AuditIndex() {
  return (
    <div className="container audit-index">
      <header className="audit-index__head">
        <h1 className="t-display-l">Auditoria pública</h1>
        <p className="t-body-l text-secondary">
          Cada lance carrega uma impressão digital que depende do anterior. Escolha um lote para recalcular a cadeia
          inteira e ver se o histórico foi alterado.
        </p>
      </header>
      <Section phase="live" title="Ao vivo" />
      <Section phase="ended" title="Encerrados" />
    </div>
  );
}
