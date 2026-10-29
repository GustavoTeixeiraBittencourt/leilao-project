import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { bidsQueryKey, fetchBids, type Bid } from "../api/bids";
import { ApiError } from "../api/client";
import { fetchLot, lotQueryKey, type Lot } from "../api/lots";
import { walletQueryKey } from "../api/wallet";
import { ArtworkSheet } from "../components/ArtworkSheet";
import { BidPanel } from "../components/BidPanel";
import { LotImage } from "../components/LotImage";
import { useAuth } from "../hooks/useAuth";
import { useLotStream, type StreamStatus } from "../hooks/useLotStream";
import { useNow } from "../hooks/useNow";
import { formatCountdown, remainingMs, serverNowMs } from "../lib/clock";
import { describeError } from "../lib/errors";
import { bidsLabel, firstLine, formatDayAt, formatMoney, lotCode } from "../lib/format";
import { bidsAscending, needsPhaseRefresh, remainingAnnouncement, standingOf } from "../lib/room";
import { Button, ButtonLink } from "../ui/Button";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import "./LotRoom.css";

const HISTORY_PREVIEW = 20;

// Pergunta de novo ao servidor quando o horário diz que a fase deve ter mudado
// (agendado -> ao vivo -> encerrado). O cliente nunca decide a fase sozinho: só sabe
// quando vale perguntar. Fica num componente próprio porque usa o relógio de 1s e não
// deve re-renderizar a sala inteira a cada segundo.
function PhaseWatcher({ lot, refetch, fetching }: { lot: Lot; refetch: () => void; fetching: boolean }) {
  const now = useNow();
  // No máximo uma pergunta a cada 2s, e nunca com outra em andamento.
  const tick = Math.floor(now / 2000);
  useEffect(() => {
    if (!fetching && needsPhaseRefresh(lot, serverNowMs(now))) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` é o gatilho de propósito
  }, [tick, lot.phase, lot.startsAt, lot.endsAt, fetching]);
  return null;
}

function Countdown({ lot, extended }: { lot: Lot; extended: boolean }) {
  useNow(); // re-renderiza a cada segundo (relógio compartilhado)

  if (lot.phase === "ended" || lot.phase === "cancelled") return null;

  const scheduled = lot.phase === "scheduled";
  const left = remainingMs(scheduled ? lot.startsAt : lot.endsAt);

  return (
    <div className="countdown">
      <span className="t-overline text-secondary">{scheduled ? "Abre em" : "Encerra em"}</span>
      <span className="t-number-l num">{left > 0 ? formatCountdown(left) : scheduled ? "Abrindo…" : "Encerrando…"}</span>
      <span className="t-caption text-secondary">
        {scheduled ? `Abre ${formatDayAt(lot.startsAt)}` : `Termina ${formatDayAt(lot.endsAt)}`}
      </span>
      {extended && !scheduled && (
        <span className="countdown__extended t-label-s">Prorrogado: novo horário final {formatDayAt(lot.endsAt)}</span>
      )}
      {/* Leitor de tela: texto por faixas de tempo, não a cada segundo. */}
      {!scheduled && (
        <span className="sr-only" aria-live="polite">
          {remainingAnnouncement(left)}
        </span>
      )}
    </div>
  );
}

const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function streamLabel(status: StreamStatus, lot: Lot): string {
  if (lot.phase === "ended") return `Encerrado · ${bidsLabel(lot.bidCount)}`;
  if (lot.phase === "cancelled") return "Lote cancelado";
  if (status === "reconnecting") return `Reconectando… · ${bidsLabel(lot.bidCount)}`;
  if (status === "connecting") return `Conectando… · ${bidsLabel(lot.bidCount)}`;
  return `Atualiza ao vivo · ${bidsLabel(lot.bidCount)}`;
}

function BidHistory({
  lot,
  bids,
  myAlias,
  status,
  loading,
}: {
  lot: Lot;
  bids: Bid[];
  myAlias: string | null;
  status: StreamStatus;
  loading: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  // O servidor entrega em ordem crescente de `seq`; na tela o mais novo vem primeiro.
  const ordered = useMemo(() => [...bids].reverse(), [bids]);
  const visible = showAll ? ordered : ordered.slice(0, HISTORY_PREVIEW);
  const leaderSeq = ordered[0]?.seq;

  return (
    <section className="history" aria-labelledby="history-title">
      <div className="history__head">
        <h2 id="history-title" className="t-h2">
          Histórico de lances
        </h2>
        <span className="t-label-s text-secondary" aria-live="polite">
          {streamLabel(status, lot)}
        </span>
      </div>

      {loading ? (
        <Skeleton style={{ height: 160 }} />
      ) : ordered.length === 0 ? (
        <EmptyState title="Nenhum lance ainda">
          {lot.phase === "live"
            ? `O primeiro lance precisa ser de pelo menos ${formatMoney(lot.startingBidCents)}.`
            : "Este lote não recebeu lances."}
        </EmptyState>
      ) : (
        <div className="history__table-wrap">
          <table className="history__table">
            <thead>
              <tr className="t-overline text-secondary">
                <th scope="col" className="history__seq">#</th>
                <th scope="col">Participante</th>
                <th scope="col" className="history__num">Valor</th>
                <th scope="col" className="history__num">Horário</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((bid) => {
                const mine = myAlias !== null && bid.bidderAlias === myAlias;
                const leader = bid.seq === leaderSeq;
                return (
                  <tr key={bid.seq} className={leader ? "history__row history__row--leader" : "history__row"}>
                    <td className="history__seq t-body-s text-secondary">{bid.seq}</td>
                    <td className="t-label-m">
                      {mine ? `Você · ${bid.bidderAlias}` : bid.bidderAlias}
                      {leader && (lot.phase === "ended" ? "  ·  vencedor" : "  ·  líder")}
                    </td>
                    <td className="history__num t-label-m num">{formatMoney(bid.amountCents)}</td>
                    <td className="history__num t-body-s text-secondary num">{timeFormat.format(new Date(bid.placedAt))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ordered.length > HISTORY_PREVIEW && (
        <Button variant="secondary" size="sm" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Mostrar só os mais recentes" : `Mostrar todos os ${ordered.length} lances`}
        </Button>
      )}
    </section>
  );
}

function RoomSkeleton() {
  return (
    <div className="container room" aria-busy="true">
      <div className="room__main">
        <Skeleton style={{ height: 520 }} />
        <Skeleton style={{ height: 56, width: "70%" }} />
        <Skeleton style={{ height: 24, width: "40%" }} />
      </div>
      <div className="room__side">
        <Skeleton style={{ height: 96 }} />
        <Skeleton style={{ height: 420 }} />
      </div>
    </div>
  );
}

export function LotRoom() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const lotQuery = useQuery({ queryKey: lotQueryKey(id), queryFn: () => fetchLot(id) });
  const bidsQuery = useQuery({
    queryKey: bidsQueryKey(id),
    queryFn: async () => bidsAscending((await fetchBids(id)).bids),
    // O SSE mantém o histórico em dia; a leitura só repete na (re)conexão do stream.
    staleTime: 60_000,
  });

  const lot = lotQuery.data;
  // Só vale abrir o stream enquanto o lote ainda pode mudar.
  const streamStatus = useLotStream(id, lot?.phase === "live" || lot?.phase === "scheduled");

  // Detecta prorrogação (anti-sniping): o horário final avançou DEPOIS da primeira leitura.
  const firstEndsAt = useRef<string | null>(null);
  const [extended, setExtended] = useState(false);
  useEffect(() => {
    if (!lot) return;
    if (firstEndsAt.current === null) firstEndsAt.current = lot.endsAt;
    else if (Date.parse(lot.endsAt) > Date.parse(firstEndsAt.current)) setExtended(true);
  }, [lot]);

  // Cada lance novo pode mudar o saldo disponível de quem lidera ou foi superado.
  const bidCount = lot?.bidCount;
  useEffect(() => {
    if (user?.role === "bidder" && bidCount !== undefined) {
      void queryClient.invalidateQueries({ queryKey: walletQueryKey });
    }
  }, [bidCount, user?.role, queryClient]);

  // Bottom sheet do mobile (no desktop o painel é fixo na coluna e isto não tem efeito).
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setSheetOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  if (lotQuery.isPending) return <RoomSkeleton />;

  if (lotQuery.isError || !lot) {
    const notFound = lotQuery.error instanceof ApiError && (lotQuery.error.code === "NOT_FOUND" || lotQuery.error.code === "VALIDATION_ERROR");
    return (
      <div className="container room-state">
        {notFound ? (
          <EmptyState title="Lote não encontrado">
            O link pode estar errado ou o lote não existe mais. <Link to="/">Voltar à vitrine</Link>
          </EmptyState>
        ) : (
          <ErrorState title="Não foi possível abrir a sala" onRetry={() => void lotQuery.refetch()}>
            {describeError(lotQuery.error)}
          </ErrorState>
        )}
      </div>
    );
  }

  const bids = bidsQuery.data ?? [];
  const standing = standingOf(lot, bids, user?.role === "bidder" ? user.publicAlias : null);
  const artist = firstLine(lot.attributes.artist_display);
  // Folha do mobile só para quem pode dar lance (ou convidado): para o leiloeiro e para
  // lotes que não estão ao vivo o painel é um aviso e fica sempre visível.
  const sheetable = lot.phase === "live" && user?.role !== "auctioneer";

  return (
    <div className="container room">
      <PhaseWatcher lot={lot} refetch={() => void lotQuery.refetch()} fetching={lotQuery.isFetching} />

      <nav className="room__crumbs t-body-m" aria-label="Você está em">
        <Link to="/" className="room__back">
          ← Vitrine
        </Link>
      </nav>

      <div className="room__main">
        <LotImage src={lot.imageUrl} alt={artist ? `${lot.title}, ${artist}` : lot.title} className="room__image" />

        <header className="room__title">
          <p className="t-overline text-secondary">Lote nº {lotCode(lot.id)}</p>
          <h1 className="t-display-l room__h1">{lot.title}</h1>
          {artist && <p className="t-body-l text-secondary">{artist}</p>}
        </header>

        <ArtworkSheet lot={lot} />

        <BidHistory lot={lot} bids={bids} myAlias={user?.publicAlias ?? null} status={streamStatus} loading={bidsQuery.isPending} />
      </div>

      <aside className="room__side">
        <Countdown lot={lot} extended={extended} />

        {sheetOpen && <div className="room__scrim" onClick={() => setSheetOpen(false)} aria-hidden="true" />}
        <div
          id="bid-sheet"
          className={["room__panel", sheetable ? "room__panel--sheetable" : "", sheetOpen ? "room__panel--open" : ""]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="room__sheet-head">
            <span className="room__sheet-handle" aria-hidden="true" />
            <button type="button" className="room__sheet-close t-label-m" onClick={() => setSheetOpen(false)}>
              Fechar
            </button>
          </div>
          <BidPanel lot={lot} standing={standing} onBidPlaced={() => setSheetOpen(false)} />
        </div>

        <div className="room__rules t-body-s">
          <p className="t-label-m">Regras de encerramento</p>
          <p className="text-secondary">
            Lances aceitos nos últimos 2 minutos prorrogam o encerramento para 2 minutos a partir do lance. O líder não
            pode cobrir o próprio lance. Valores reservados voltam ao saldo quando você é superado.
          </p>
        </div>

        {/* Único acesso à auditoria nesta tela (o histórico não repete o link). */}
        <ButtonLink to={`/audit/${lot.id}`} variant="secondary" className="room__audit">
          Auditoria pública deste lote →
        </ButtonLink>
      </aside>

      {/* Barra fixa do mobile (Figma: Bid Bar): lance atual + atalho para a folha. */}
      {sheetable && (
        <div className="bid-bar">
          <div className="bid-bar__info">
            <span className="t-overline text-secondary">{lot.bidCount > 0 ? "Lance atual" : "Lance inicial"}</span>
            <span className="t-number-m num">{formatMoney(lot.currentBidCents ?? lot.startingBidCents)}</span>
            {standing === "leading" && <span className="bid-bar__state t-label-s">✓ Você está ganhando</span>}
            {standing === "outbid" && <span className="bid-bar__state bid-bar__state--warn t-label-s">Você foi superado</span>}
          </div>
          <Button aria-expanded={sheetOpen} aria-controls="bid-sheet" onClick={() => setSheetOpen(true)}>
            Fazer lance
          </Button>
        </div>
      )}
    </div>
  );
}
