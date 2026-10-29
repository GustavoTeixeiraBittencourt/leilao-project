import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchMyAuctions, myAuctionsQueryKey, type MyLot } from "../api/auctioneer";
import { LotImage } from "../components/LotImage";
import { computeKpis, resultText } from "../lib/auctioneer";
import { describeError } from "../lib/errors";
import { formatDateTime, formatMoney } from "../lib/format";
import { ButtonLink } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import "./AuctioneerDashboard.css";

function LotRow({ lot }: { lot: MyLot }) {
  const price = lot.finalPriceCents ?? lot.currentBidCents;
  return (
    <tr className="my-lot">
      <td data-label="Obra" className="my-lot__work">
        <LotImage src={lot.imageUrl} alt="" className="my-lot__image" />
        {lot.phase === "cancelled" ? (
          <span className="t-label-m">{lot.title}</span>
        ) : (
          <Link to={`/lots/${lot.id}`} className="t-label-m my-lot__link">
            {lot.title}
          </Link>
        )}
      </td>
      <td data-label="Estado">
        <StatusBadge phase={lot.phase} />
      </td>
      <td data-label="Período" className="my-lot__period t-body-s text-secondary num">
        <span>Abre {formatDateTime(lot.startsAt)}</span>
        <span>Encerra {formatDateTime(lot.endsAt)}</span>
      </td>
      <td data-label="Valor" className="my-lot__price t-label-m num">
        {price === null ? "—" : formatMoney(price)}
      </td>
      <td data-label="Resultado" className="t-body-s text-secondary">
        {resultText(lot)}
      </td>
      <td data-label="Ações" className="my-lot__actions-cell">
        {(lot.phase === "ended" || lot.canCancel) && (
          <div className="my-lot__actions">
            {lot.phase === "ended" && (
              <Link to={`/audit/${lot.id}`} className="my-lot__link t-label-s">
                Ver auditoria
              </Link>
            )}
            {lot.canCancel && (
              <ButtonLink to={`/auctioneer/lots/${lot.id}/edit`} variant="secondary" size="sm">
                Editar lote
              </ButtonLink>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function AuctioneerDashboard() {
  // Atualiza sozinho: lances chegam, lotes abrem e encerram enquanto a tela está aberta.
  const query = useQuery({ queryKey: myAuctionsQueryKey, queryFn: fetchMyAuctions, refetchInterval: 10_000 });

  return (
    <div className="container dashboard">
      <header className="dashboard__head">
        <div className="dashboard__titles">
          <h1 className="t-display-l dashboard__title">Meus lotes</h1>
        </div>
        <ButtonLink to="/auctioneer/new">+ Novo lote</ButtonLink>
      </header>

      {query.isPending ? (
        <div aria-busy="true" className="dashboard__loading">
          <Skeleton style={{ height: 96 }} />
          <Skeleton style={{ height: 280 }} />
        </div>
      ) : query.isError ? (
        <ErrorState title="Não foi possível carregar seus lotes" onRetry={() => void query.refetch()}>
          {describeError(query.error)}
        </ErrorState>
      ) : (
        <Content lots={query.data.lots} totalReceivedCents={query.data.totalReceivedCents} />
      )}
    </div>
  );
}

function Content({ lots, totalReceivedCents }: { lots: MyLot[]; totalReceivedCents: number }) {
  const kpis = computeKpis(lots);

  return (
    <>
      <section className="summary" aria-label="Resumo dos lotes">
        <div className="summary__money">
          <span className="t-overline text-secondary">Total recebido</span>
          <span className="t-number-xl num">{formatMoney(totalReceivedCents)}</span>
          <span className="t-caption text-secondary">já liquidado na sua carteira</span>
        </div>
        <ul className="summary__counts">
          <li>
            <span className="t-number-m num">{kpis.live}</span>
            <span className="t-body-s">ao vivo</span>
          </li>
          <li>
            <span className="t-number-m num">{kpis.scheduled}</span>
            <span className="t-body-s">agendados</span>
          </li>
          <li>
            <span className="t-number-m num">{kpis.ended}</span>
            <span className="t-body-s">encerrados</span>
            <span className="t-caption text-secondary">
              {kpis.endedSold} arrematado{kpis.endedSold === 1 ? "" : "s"} · {kpis.endedUnsold} sem lances
            </span>
          </li>
        </ul>
      </section>

      {lots.length === 0 ? (
        <EmptyState title="Você ainda não criou nenhum lote">
          Busque uma obra no acervo e publique o primeiro lote. <Link to="/auctioneer/new">Criar lote</Link>
        </EmptyState>
      ) : (
        <div className="dashboard__table-wrap">
          <table className="dashboard__table">
            <thead>
              <tr className="t-overline text-secondary">
                <th scope="col">Obra</th>
                <th scope="col">Estado</th>
                <th scope="col">Período</th>
                <th scope="col" className="dashboard__price">Valor</th>
                <th scope="col">Resultado</th>
                <th scope="col" className="dashboard__actions">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <LotRow key={lot.id} lot={lot} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
