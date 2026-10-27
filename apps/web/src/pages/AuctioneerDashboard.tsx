import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { cancelLot, fetchMyAuctions, myAuctionsQueryKey, type MyLot } from "../api/auctioneer";
import { LotImage } from "../components/LotImage";
import { computeKpis, resultText } from "../lib/auctioneer";
import { describeError } from "../lib/errors";
import { formatDateTime, formatMoney } from "../lib/format";
import { Button, ButtonLink } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { StatusBadge } from "../ui/StatusBadge";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import "./AuctioneerDashboard.css";

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="kpi">
      <span className="t-overline text-secondary">{label}</span>
      <span className="t-number-l num">{value}</span>
      <span className="t-caption text-secondary">{hint}</span>
    </div>
  );
}

// "28/10 14:00 · 20:00": início e fim; o dia do fim só aparece quando muda.
function period(lot: MyLot): string {
  const start = formatDateTime(lot.startsAt);
  const end = formatDateTime(lot.endsAt);
  return start.slice(0, 5) === end.slice(0, 5) ? `${start} · ${end.slice(6)}` : `${start} · ${end}`;
}

function CancelAction({ lot }: { lot: MyLot }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => cancelLot(lot.id),
    onSuccess: () => {
      setConfirming(false);
      setError(null);
      // O lote some da vitrine e muda de estado aqui; a lista pública também se atualiza.
      void queryClient.invalidateQueries({ queryKey: myAuctionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["lots"] });
    },
    onError: (err) => {
      setError(describeError(err));
      // O lote pode ter recebido um lance enquanto a tela estava aberta: relê o estado real.
      void queryClient.invalidateQueries({ queryKey: myAuctionsQueryKey });
    },
  });

  if (!lot.canCancel) return null;

  // Cancelar é irreversível: pede uma segunda confirmação, na própria linha.
  if (!confirming) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        Cancelar lote
      </Button>
    );
  }

  return (
    <div className="cancel-confirm" role="group" aria-label={`Confirmar cancelamento de ${lot.title}`}>
      <Button variant="danger" size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
        Confirmar cancelamento
      </Button>
      <Button variant="secondary" size="sm" disabled={mutation.isPending} onClick={() => setConfirming(false)}>
        Voltar
      </Button>
      {error && (
        <p className="t-caption cancel-confirm__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

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
      <td data-label="Início · Fim" className="t-body-s text-secondary num">
        {period(lot)}
      </td>
      <td data-label="Lance atual" className="my-lot__price t-label-m num">
        {price === null ? "—" : formatMoney(price)}
      </td>
      <td data-label="Resultado / ação">
        <div className="my-lot__result">
          <span className="t-body-s text-secondary">{resultText(lot)}</span>
          <div className="my-lot__actions">
            {lot.phase === "ended" && (
              <Link to={`/audit/${lot.id}`} className="my-lot__link t-label-s">
                Ver auditoria
              </Link>
            )}
            <CancelAction lot={lot} />
          </div>
        </div>
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
          <p className="t-overline text-secondary">Painel do leiloeiro</p>
          <h1 className="t-display-l">Meus lotes</h1>
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
      <div className="dashboard__kpis">
        <Kpi label="Ao vivo" value={String(kpis.live)} hint="aceitando lances agora" />
        <Kpi label="Agendados" value={String(kpis.scheduled)} hint="ainda não abriram" />
        <Kpi
          label="Encerrados"
          value={String(kpis.ended)}
          hint={`${kpis.endedSold} arrematado${kpis.endedSold === 1 ? "" : "s"} · ${kpis.endedUnsold} sem lances`}
        />
        <Kpi label="Total recebido" value={formatMoney(totalReceivedCents)} hint="já liquidado na sua carteira" />
      </div>

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
                <th scope="col">Início · Fim</th>
                <th scope="col" className="dashboard__price">Lance atual</th>
                <th scope="col">Resultado / ação</th>
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

      <Notice tone="warning" icon="!" className="dashboard__note">
        Cancelar só é permitido sem lances. Lotes cancelados nunca aparecem na vitrine. Esta área não oferece ações de
        lance: leiloeiros não podem dar lances.
      </Notice>
    </>
  );
}
