import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { bidsQueryKey, placeBid, type Bid } from "../api/bids";
import { ApiError } from "../api/client";
import { lotQueryKey, type Lot } from "../api/lots";
import { fetchWallet, walletQueryKey } from "../api/wallet";
import { myBidsQueryKey } from "../api/wins";
import { useAuth } from "../hooks/useAuth";
import { describeError, messageForCode } from "../lib/errors";
import { bidsLabel, formatDayAt, formatMoney } from "../lib/format";
import { centsToInput, parseMoneyToCents } from "../lib/money";
import { applyBidPlaced, mergeBid, minNextBidCents, type Standing } from "../lib/room";
import { Button, ButtonLink } from "../ui/Button";
import { moneyInputProps } from "../ui/MoneyInput";
import { Notice } from "../ui/Notice";
import { StatusBadge } from "../ui/StatusBadge";
import "./BidPanel.css";

// Erros que significam "o que a tela mostra já não é o que o servidor tem": o lote
// é relido para a pessoa ver o estado real em vez de insistir num lance condenado.
const STALE_STATE_CODES = new Set(["BID_BELOW_MIN", "ALREADY_LEADING", "LOT_CLOSED", "LOT_NOT_STARTED"]);

type BidPanelProps = {
  lot: Lot;
  standing: Standing;
  // Chamado depois de um lance aceito (o mobile fecha a folha com isso).
  onBidPlaced?: () => void;
};

// Painel de lance do Figma (BidPanel). Todas as recusas aparecem junto do campo; os
// bloqueios (já lidera, sem saldo, leiloeiro, lote não iniciado/encerrado) são
// montados aqui. Nada disso substitui o servidor: ele valida de novo e responde com
// um código estável, que messageForCode traduz.
export function BidPanel({ lot, standing, onBidPlaced }: BidPanelProps) {
  const { user } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();

  const isBidder = user?.role === "bidder";
  const wallet = useQuery({ queryKey: walletQueryKey, queryFn: fetchWallet, enabled: isBidder, staleTime: 15_000 });
  const available = wallet.data?.availableCents ?? null;

  const minCents = minNextBidCents(lot);
  // `null` = o usuário ainda não mexeu no campo: ele acompanha o mínimo atual (quando
  // alguém cobre o lance, o valor sugerido sobe sozinho). Depois de digitar, vale o que ele escreveu.
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const value = typed ?? centsToInput(minCents);

  const bid = useMutation({
    mutationFn: (amountCents: number) => placeBid(lot.id, amountCents),
    onSuccess: (result) => {
      // O mesmo lance chega aqui e pelo SSE; applyBidPlaced/mergeBid ignoram o repetido.
      queryClient.setQueryData<Lot>(lotQueryKey(lot.id), (current) =>
        current
          ? applyBidPlaced(current, {
              type: "bid_placed",
              lotId: lot.id,
              bid: { seq: result.bid.seq, bidderAlias: user?.publicAlias ?? "", amountCents: result.bid.amountCents, placedAt: result.bid.placedAt },
              currentBidCents: result.lot.currentBidCents ?? result.bid.amountCents,
              bidCount: result.lot.bidCount,
              leaderAlias: result.lot.leaderAlias ?? "",
              endsAt: result.lot.endsAt,
              extended: result.extended,
              serverNow: result.lot.serverNow,
            })
          : current,
      );
      queryClient.setQueryData<Bid[]>(bidsQueryKey(lot.id), (list) =>
        list && user
          ? mergeBid(list, { seq: result.bid.seq, bidderAlias: user.publicAlias, amountCents: result.bid.amountCents, placedAt: result.bid.placedAt })
          : list,
      );
      queryClient.setQueryData(walletQueryKey, (current: unknown) =>
        current && typeof current === "object" ? { ...current, ...result.wallet } : current,
      );
      // "Meus arremates" ganha (ou atualiza) este lote assim que a pessoa voltar para lá.
      void queryClient.invalidateQueries({ queryKey: myBidsQueryKey });
      setTyped(null);
      setError(null);
      setConfirmation(
        result.extended
          ? "Lance registrado. O encerramento foi prorrogado em 2 minutos."
          : "Lance registrado. Você está ganhando.",
      );
      onBidPlaced?.();
    },
    onError: (err) => {
      setConfirmation(null);
      setError(describeError(err));
      if (err instanceof ApiError && STALE_STATE_CODES.has(err.code)) {
        void queryClient.invalidateQueries({ queryKey: lotQueryKey(lot.id) });
        void queryClient.invalidateQueries({ queryKey: bidsQueryKey(lot.id) });
      }
      void queryClient.invalidateQueries({ queryKey: walletQueryKey });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setConfirmation(null);
    const cents = parseMoneyToCents(value);
    if (cents === null) {
      setError("Informe um valor válido, por exemplo 12.950,00.");
      return;
    }
    if (cents < minCents) {
      setError(`${messageForCode("BID_BELOW_MIN")} Mínimo agora: ${formatMoney(minCents)}.`);
      return;
    }
    setError(null);
    bid.mutate(cents);
  }

  const hasBids = lot.bidCount > 0 && lot.currentBidCents !== null;

  return (
    <section className="bid-panel" aria-label="Painel de lance">
      <StatusBadge phase={lot.phase} />

      <div className="bid-panel__current">
        <span className="t-overline text-secondary">{hasBids ? "Lance atual" : "Lance inicial"}</span>
        <span className="bid-panel__amount t-number-xl">
          {formatMoney(hasBids ? (lot.currentBidCents as number) : lot.startingBidCents)}
        </span>
        {lot.phase === "live" && (
          <span className="t-body-s text-secondary">
            {bidsLabel(lot.bidCount)} · mínimo para o próximo: {formatMoney(minCents)}
          </span>
        )}
      </div>

      {lot.phase === "scheduled" && (
        <Notice tone="warning" title="Lote ainda não aberto">
          Os lances começam em {formatDayAt(lot.startsAt)}. Você pode acompanhar a sala desde já.
        </Notice>
      )}

      {lot.phase === "cancelled" && (
        <Notice tone="danger" title="Lote cancelado">
          O leiloeiro cancelou este lote antes de ele receber lances.
        </Notice>
      )}

      {lot.phase === "ended" && <EndedResult lot={lot} />}

      {lot.phase === "live" && !user && (
        <>
          <Notice tone="warning" title="Entre para dar lances">
            Você precisa de uma conta de licitante para participar.
          </Notice>
          <ButtonLink to="/login" state={{ from: location.pathname }} className="bid-panel__submit">
            Entrar para dar lance
          </ButtonLink>
        </>
      )}

      {lot.phase === "live" && user?.role === "auctioneer" && (
        <Notice tone="warning" icon="!" title="Leiloeiros não podem dar lances">
          Esta conta é de leiloeiro. Para participar, entre com uma conta de licitante.
        </Notice>
      )}

      {lot.phase === "live" && isBidder && (
        <>
          {standing === "leading" && (
            <Notice tone="success" icon="✓" title="Você está ganhando">
              Seu lance de {formatMoney(lot.currentBidCents ?? 0)} está reservado e fica indisponível na carteira até
              você ser superado.
            </Notice>
          )}
          {standing === "outbid" && (
            <Notice tone="warning" icon="!" title="Você foi superado">
              O valor que estava reservado voltou para a sua carteira. Dê um lance de pelo menos{" "}
              {formatMoney(minCents)} para voltar à frente.
            </Notice>
          )}

          <form className="bid-panel__form" onSubmit={submit} noValidate>
            <label htmlFor="bid-amount" className="t-label-m">
              Seu lance
            </label>
            <div className={["bid-input", error ? "bid-input--error" : ""].filter(Boolean).join(" ")}>
              <span className="bid-input__prefix t-number-m" aria-hidden="true">
                US$
              </span>
              <input
                id="bid-amount"
                className="bid-input__field t-number-m"
                value={value}
                disabled={standing === "leading"}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "bid-error" : "bid-help"}
                {...moneyInputProps((text) => {
                  setTyped(text);
                  setError(null);
                  setConfirmation(null);
                })}
              />
            </div>
            {error ? (
              <p id="bid-error" className="bid-panel__error t-caption" role="alert">
                {error}
              </p>
            ) : (
              <p id="bid-help" className="t-caption text-secondary">
                Mínimo: {formatMoney(minCents)}
              </p>
            )}
            {confirmation && (
              <p className="bid-panel__ok t-caption" role="status">
                {confirmation}
              </p>
            )}

            {available !== null && available < minCents && standing !== "leading" && (
              <Notice tone="warning" title="Saldo insuficiente">
                O mínimo para o próximo lance é {formatMoney(minCents)} e você tem {formatMoney(available)}{" "}
                disponíveis. <Link to="/wallet">Depositar na carteira</Link>
              </Notice>
            )}

            <Button
              type="submit"
              loading={bid.isPending}
              disabled={standing === "leading" || (available !== null && available < minCents)}
              className="bid-panel__submit"
            >
              {standing === "leading" ? "Você já lidera" : "Fazer lance"}
            </Button>
          </form>

          <div className="bid-panel__available t-body-s">
            <span className="text-secondary">Disponível na carteira</span>
            <span className="t-label-m num">{available === null ? "—" : formatMoney(available)}</span>
          </div>
        </>
      )}
    </section>
  );
}

function EndedResult({ lot }: { lot: Lot }) {
  if (!lot.winnerAlias || lot.finalPriceCents === null) {
    return (
      <Notice tone="warning" title="Encerrado sem lances">
        Este lote terminou sem receber nenhum lance e não teve vencedor.
      </Notice>
    );
  }
  return (
    <Notice tone="success" icon="✓" title="Lote arrematado">
      {lot.winnerAlias} arrematou por {formatMoney(lot.finalPriceCents)}.
    </Notice>
  );
}
