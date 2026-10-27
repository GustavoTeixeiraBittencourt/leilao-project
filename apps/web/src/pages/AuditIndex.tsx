import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchLots, lotsQueryKey, type ListedPhase, type Lot } from "../api/lots";
import { describeError } from "../lib/errors";
import { bidsLabel, formatDayAt, formatMoney, lotCode } from "../lib/format";
import { StatusBadge } from "../ui/StatusBadge";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import "./AuditIndex.css";

const LIMIT = 50;

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

  return (
    <section className="audit-index__section" aria-labelledby={`audit-${phase}`}>
      <h2 id={`audit-${phase}`} className="t-h2">
        {title}
      </h2>
      {query.isPending ? (
        <Skeleton style={{ height: 96 }} />
      ) : query.isError ? (
        <ErrorState title="Não foi possível carregar" onRetry={() => void query.refetch()}>
          {describeError(query.error)}
        </ErrorState>
      ) : query.data.lots.length === 0 ? (
        <EmptyState title="Nenhum lote por aqui" />
      ) : (
        <ul className="audit-index__list">
          {query.data.lots.map((lot) => (
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
        <p className="t-overline text-secondary">Sem login · qualquer pessoa pode conferir</p>
        <h1 className="t-display-l">Auditoria pública</h1>
        <p className="t-body-l text-secondary">
          Cada lance carrega uma impressão digital que depende do anterior. Escolha um lote para recalcular a cadeia
          inteira e ver se o histórico foi alterado.
        </p>
      </header>
      <Section phase="ended" title="Encerrados" />
      <Section phase="live" title="Ao vivo" />
    </div>
  );
}
