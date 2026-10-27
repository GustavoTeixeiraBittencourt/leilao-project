import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { fetchWins, winsQueryKey, type Win } from "../api/wins";
import { LotImage } from "../components/LotImage";
import { receiptUrl } from "../lib/audit";
import { describeError } from "../lib/errors";
import { formatDayAt, formatMoney } from "../lib/format";
import { Button, ButtonLink } from "../ui/Button";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import "./Wins.css";

type CopyState = { token: string; ok: boolean } | null;

function WinRow({ win, copy, onCopy }: { win: Win; copy: CopyState; onCopy: (win: Win) => void }) {
  const status = copy?.token === win.receiptToken ? copy : null;
  return (
    <li className="win">
      <LotImage src={win.imageUrl} alt={win.title} className="win__image" />
      <div className="win__info">
        <h2 className="t-h2 win__title">{win.title}</h2>
        <p className="t-caption text-secondary">Liquidado em {formatDayAt(win.issuedAt)}</p>
      </div>
      <div className="win__amount">
        <span className="t-overline text-secondary">Valor final</span>
        <span className="t-number-m num">{formatMoney(win.amountCents)}</span>
      </div>
      <span className="win__settled t-label-s">✓ Liquidado</span>
      <div className="win__actions">
        <ButtonLink to={`/r/${win.receiptToken}`} variant="secondary">
          Ver comprovante
        </ButtonLink>
        <Button variant="secondary" size="sm" className="win__copy" onClick={() => onCopy(win)}>
          Copiar link público
        </Button>
        <span className="t-caption text-secondary" role="status">
          {status?.ok === true && "Link copiado."}
          {status?.ok === false && "Não foi possível copiar; abra o comprovante e use a barra de endereço."}
        </span>
      </div>
    </li>
  );
}

export function Wins() {
  const query = useQuery({ queryKey: winsQueryKey, queryFn: fetchWins });
  const [copy, setCopy] = useState<CopyState>(null);

  async function copyLink(win: Win) {
    try {
      await navigator.clipboard.writeText(receiptUrl(window.location.origin, win.receiptToken));
      setCopy({ token: win.receiptToken, ok: true });
    } catch {
      // Sem permissão de área de transferência (http, iframe): avisa em vez de falhar calado.
      setCopy({ token: win.receiptToken, ok: false });
    }
  }

  return (
    <div className="container wins">
      <header className="wins__title">
        <h1 className="t-display-l">Meus arremates</h1>
      </header>
      <p className="t-body-m text-secondary">
        O resultado só é definitivo depois da liquidação: o valor é debitado da carteira e o comprovante é emitido.
      </p>

      {query.isPending ? (
        <div className="wins__list" aria-busy="true">
          <Skeleton style={{ height: 120 }} />
          <Skeleton style={{ height: 120 }} />
        </div>
      ) : query.isError ? (
        <ErrorState title="Não foi possível carregar seus arremates" onRetry={() => void query.refetch()}>
          {describeError(query.error)}
        </ErrorState>
      ) : query.data.length === 0 ? (
        <EmptyState title="Você ainda não arrematou nenhum lote">
          Quando você vencer um leilão, ele aparece aqui com o comprovante. <Link to="/">Ver lotes ao vivo</Link>
        </EmptyState>
      ) : (
        <ul className="wins__list">
          {query.data.map((win) => (
            <WinRow key={win.receiptToken} win={win} copy={copy} onCopy={(w) => void copyLink(w)} />
          ))}
        </ul>
      )}
    </div>
  );
}
