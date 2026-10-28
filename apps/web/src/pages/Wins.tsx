import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchMyBids, myBidsQueryKey, type MyBid } from "../api/wins";
import { LotImage } from "../components/LotImage";
import { useNow } from "../hooks/useNow";
import { receiptUrl } from "../lib/audit";
import { formatCountdownShort, remainingMs } from "../lib/clock";
import { describeError } from "../lib/errors";
import { bidsLabel, formatDayAt, formatDayMonth, formatMoney } from "../lib/format";
import { BID_TABS, bidAction, countByTab, emptyCopy, filterByTab, parseBidTab, type BidTab } from "../lib/myBids";
import { BidStatusBadge } from "../ui/BidStatusBadge";
import { Button, ButtonLink } from "../ui/Button";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import "./Wins.css";

type CopyState = { token: string; ok: boolean } | null;

// Linha de apoio sob o título: quando termina (ao vivo), quando foi liquidado (arrematado)
// ou quando encerrou (não arrematado). O relógio é o do servidor (ver lib/clock).
function WhenLine({ bid }: { bid: MyBid }) {
  useNow(); // re-renderiza a cada segundo (relógio compartilhado)
  const mine = `Você deu ${bidsLabel(bid.myBidCount)}`;
  if (bid.phase === "live") {
    const left = remainingMs(bid.endsAt);
    return (
      <p className="t-caption text-secondary num">
        {left > 0 ? `Termina em ${formatCountdownShort(left)}` : "Encerrando…"} · {mine}
      </p>
    );
  }
  if (bid.status === "won" && bid.issuedAt) {
    return (
      <p className="t-caption text-secondary">
        Liquidado em {formatDayAt(bid.issuedAt)} · {mine}
      </p>
    );
  }
  return (
    <p className="t-caption text-secondary">
      Encerrou {formatDayMonth(bid.endsAt)} · {mine}
    </p>
  );
}

function Amounts({ bid }: { bid: MyBid }) {
  if (bid.status === "won") {
    return (
      <div className="win__amount">
        <span className="t-overline text-secondary">Valor final</span>
        <span className="t-number-m num">{formatMoney(bid.currentBidCents ?? bid.myHighestBidCents)}</span>
      </div>
    );
  }
  const open = bid.phase === "live";
  return (
    <div className="win__amounts">
      <div className="win__amount">
        <span className="t-overline text-secondary">Seu maior lance</span>
        <span className="t-number-m num">{formatMoney(bid.myHighestBidCents)}</span>
      </div>
      {bid.currentBidCents !== null && (
        <div className="win__amount">
          <span className="t-overline text-secondary">{open ? "Lance atual" : "Valor final"}</span>
          <span className="t-number-m num">{formatMoney(bid.currentBidCents)}</span>
        </div>
      )}
    </div>
  );
}

function Actions({ bid, copy, onCopy }: { bid: MyBid; copy: CopyState; onCopy: (bid: MyBid) => void }) {
  const action = bidAction(bid);
  if (action === "receipt" && bid.receiptToken) {
    const status = copy?.token === bid.receiptToken ? copy : null;
    return (
      <div className="win__actions">
        <ButtonLink to={`/r/${bid.receiptToken}`} variant="secondary">
          Ver comprovante
        </ButtonLink>
        <Button variant="secondary" size="sm" className="win__copy" onClick={() => onCopy(bid)}>
          Copiar link público
        </Button>
        <span className="t-caption text-secondary" role="status">
          {status?.ok === true && "Link copiado."}
          {status?.ok === false && "Não foi possível copiar; abra o comprovante e use a barra de endereço."}
        </span>
      </div>
    );
  }
  return (
    <div className="win__actions">
      {action === "cover" && <ButtonLink to={`/lots/${bid.lotId}`}>Cobrir lance</ButtonLink>}
      {action === "room" && (
        <ButtonLink to={`/lots/${bid.lotId}`} variant="secondary">
          Ir para a sala
        </ButtonLink>
      )}
      {(action === "audit" || action === "receipt") && (
        <ButtonLink to={`/audit/${bid.lotId}`} variant="secondary">
          Ver auditoria
        </ButtonLink>
      )}
    </div>
  );
}

function BidRow({ bid, copy, onCopy }: { bid: MyBid; copy: CopyState; onCopy: (bid: MyBid) => void }) {
  return (
    <li className="win">
      <LotImage src={bid.imageUrl} alt={bid.title} className="win__image" />
      <div className="win__info">
        <BidStatusBadge status={bid.status} />
        <h2 className="t-h2 win__title">
          <Link to={`/lots/${bid.lotId}`} className="win__link">
            {bid.title}
          </Link>
        </h2>
        <WhenLine bid={bid} />
      </div>
      <Amounts bid={bid} />
      <Actions bid={bid} copy={copy} onCopy={onCopy} />
    </li>
  );
}

export function Wins() {
  // Atualiza sozinho: alguém cobre meu lance, o lote fecha e ganha comprovante.
  const query = useQuery({ queryKey: myBidsQueryKey, queryFn: fetchMyBids, refetchInterval: 10_000 });
  const [params, setParams] = useSearchParams();
  const tab = parseBidTab(params.get("tab"));
  const [copy, setCopy] = useState<CopyState>(null);

  function selectTab(next: BidTab) {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === "all") updated.delete("tab");
        else updated.set("tab", next);
        return updated;
      },
      { replace: true },
    );
  }

  async function copyLink(bid: MyBid) {
    if (!bid.receiptToken) return;
    try {
      await navigator.clipboard.writeText(receiptUrl(window.location.origin, bid.receiptToken));
      setCopy({ token: bid.receiptToken, ok: true });
    } catch {
      // Sem permissão de área de transferência (http, iframe): avisa em vez de falhar calado.
      setCopy({ token: bid.receiptToken, ok: false });
    }
  }

  const bids = query.data;
  const counts = bids ? countByTab(bids) : null;
  const visible = bids ? filterByTab(bids, tab) : [];
  const empty = emptyCopy(tab);

  return (
    <div className="container wins">
      <header className="wins__title">
        <h1 className="t-display-l">Meus arremates</h1>
      </header>
      <p className="t-body-m text-secondary">
        Os lotes em que você deu lance, do mais recente ao mais antigo. Quando você vence, o valor é debitado da carteira
        na liquidação e o comprovante é emitido.
      </p>

      {bids && bids.length > 0 && counts && (
        <nav className="wins__tabs" aria-label="Situação dos lances">
          {BID_TABS.map(({ tab: id, label }) => (
            <button
              key={id}
              type="button"
              className={`wins__tab${tab === id ? " wins__tab--active" : ""}`}
              aria-pressed={tab === id}
              onClick={() => selectTab(id)}
            >
              <span className="t-h3">
                {label} · {counts[id]}
              </span>
            </button>
          ))}
        </nav>
      )}

      {query.isPending ? (
        <div className="wins__list" aria-busy="true">
          <Skeleton style={{ height: 120 }} />
          <Skeleton style={{ height: 120 }} />
        </div>
      ) : query.isError ? (
        <ErrorState title="Não foi possível carregar seus arremates" onRetry={() => void query.refetch()}>
          {describeError(query.error)}
        </ErrorState>
      ) : visible.length === 0 ? (
        <EmptyState title={empty.title}>
          {empty.text} <Link to="/">Ver lotes ao vivo</Link>
        </EmptyState>
      ) : (
        <ul className="wins__list">
          {visible.map((bid) => (
            <BidRow key={bid.lotId} bid={bid} copy={copy} onCopy={(item) => void copyLink(item)} />
          ))}
        </ul>
      )}
    </div>
  );
}
