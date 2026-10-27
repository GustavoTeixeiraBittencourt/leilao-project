import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { deposit, fetchWallet, walletQueryKey, type Wallet as WalletData } from "../api/wallet";
import { useAuth } from "../hooks/useAuth";
import { describeError } from "../lib/errors";
import { formatDateTime, formatMoney, lotCode } from "../lib/format";
import { addToAmount, checkDeposit, entryLabel, formatSigned, MAX_DEPOSIT_CENTS } from "../lib/wallet";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import "./Wallet.css";

const QUICK_AMOUNTS = [
  { label: "+ 500", cents: 50_000 },
  { label: "+ 1.000", cents: 100_000 },
  { label: "+ 5.000", cents: 500_000 },
];

function Balances({ wallet }: { wallet: WalletData }) {
  return (
    <div className="wallet__balances">
      <div className="balance-card">
        <span className="t-overline text-secondary">Saldo total</span>
        <span className="t-number-l num">{formatMoney(wallet.totalCents)}</span>
        <span className="t-body-s">Soma de todos os lançamentos</span>
      </div>
      <div className="balance-card balance-card--committed">
        <span className="t-overline">Comprometido</span>
        <span className="t-number-l num">{formatMoney(wallet.committedCents)}</span>
        <span className="t-body-s">Reservado em lotes onde você lidera. Indisponível para novos lances.</span>
      </div>
      <div className="balance-card balance-card--available">
        <span className="t-overline">Disponível</span>
        <span className="t-number-l num">{formatMoney(wallet.availableCents)}</span>
        <span className="t-body-s">Total − comprometido. É o que vale para novos lances.</span>
      </div>
    </div>
  );
}

function Statement({ wallet }: { wallet: WalletData }) {
  return (
    <section className="wallet__statement" aria-labelledby="statement-title">
      <h2 id="statement-title" className="t-h2">
        Movimentações
      </h2>

      {wallet.entries.length === 0 ? (
        <EmptyState title="Nenhuma movimentação ainda">Os depósitos e as liquidações dos lotes aparecem aqui.</EmptyState>
      ) : (
        <div className="statement__wrap">
          <table className="statement__table">
            <thead>
              <tr className="t-overline text-secondary">
                <th scope="col">Data</th>
                <th scope="col">Tipo</th>
                <th scope="col" className="statement__lot">Lote</th>
                <th scope="col" className="statement__num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {wallet.entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="t-body-s text-secondary num">{formatDateTime(entry.createdAt)}</td>
                  <td className="t-label-m">{entryLabel(entry.kind)}</td>
                  <td className="statement__lot t-body-s text-secondary">
                    {entry.lotId ? (
                      <Link to={`/lots/${entry.lotId}`} className="statement__link">
                        Lote nº {lotCode(entry.lotId)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`statement__num t-label-m num ${entry.amountCents > 0 ? "statement__num--in" : ""}`}>
                    {formatSigned(entry.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="t-caption text-secondary">
        O extrato é um registro somente de acréscimo: lançamentos não são editados nem apagados. O comprometido não
        aparece aqui porque é derivado dos lotes em que você lidera. Mostra os 50 lançamentos mais recentes.
      </p>
    </section>
  );
}

function DepositPanel() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("1.000,00");
  const [error, setError] = useState<string | null>(null);
  const [confirmedCents, setConfirmedCents] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: (cents: number) => deposit(cents),
    onSuccess: (_result, cents) => {
      setConfirmedCents(cents);
      setError(null);
      // Saldo, extrato e o "Disponível" do cabeçalho vêm todos desta mesma consulta.
      void queryClient.invalidateQueries({ queryKey: walletQueryKey });
    },
    onError: (err) => {
      setConfirmedCents(null);
      setError(describeError(err));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setConfirmedCents(null);
    const check = checkDeposit(text);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    mutation.mutate(check.cents);
  }

  return (
    <form className="deposit" onSubmit={submit} noValidate>
      <h2 className="t-h3">Depósito simulado</h2>
      <p className="t-body-s text-secondary">Nenhum dinheiro real é movimentado. Use para testar lances.</p>

      <Field
        label="Valor do depósito (US$)"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        error={error ?? undefined}
        hint={`Máximo ${formatMoney(MAX_DEPOSIT_CENTS)} por depósito`}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
          setConfirmedCents(null);
        }}
      />

      <div className="deposit__chips" role="group" aria-label="Atalhos de valor">
        {QUICK_AMOUNTS.map((amount) => (
          <button
            key={amount.cents}
            type="button"
            className="chip t-label-s"
            onClick={() => {
              setText((current) => addToAmount(current, amount.cents));
              setError(null);
              setConfirmedCents(null);
            }}
          >
            {amount.label}
          </button>
        ))}
      </div>

      <Button type="submit" loading={mutation.isPending} className="deposit__submit">
        Depositar (simulado)
      </Button>

      {confirmedCents !== null && (
        <div className="toast" role="status">
          <span className="toast__icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <p className="t-label-m">Depósito confirmado</p>
            <p className="t-body-s text-secondary">{formatMoney(confirmedCents)} foram adicionados ao seu saldo total.</p>
          </div>
        </div>
      )}
    </form>
  );
}

export function Wallet() {
  const { user } = useAuth();
  // O comprometido muda quando alguém cobre um lance seu em outro lote; a tela se
  // atualiza sozinha (e ao voltar para a aba) em vez de mostrar um valor velho.
  const query = useQuery({ queryKey: walletQueryKey, queryFn: fetchWallet, refetchInterval: 10_000 });
  const isBidder = user?.role === "bidder";

  return (
    <div className="container wallet">
      <header className="wallet__title">
        <p className="t-overline text-secondary">Sua conta · saldo simulado</p>
        <h1 className="t-display-l">Carteira</h1>
      </header>

      {query.isPending ? (
        <div className="wallet__balances" aria-busy="true">
          <Skeleton style={{ height: 130 }} />
          <Skeleton style={{ height: 130 }} />
          <Skeleton style={{ height: 130 }} />
        </div>
      ) : query.isError ? (
        <ErrorState title="Não foi possível carregar a carteira" onRetry={() => void query.refetch()}>
          {describeError(query.error)}
        </ErrorState>
      ) : (
        <>
          <Balances wallet={query.data} />
          <p className="t-body-m text-secondary">
            Disponível = total − comprometido. O valor comprometido é a soma dos seus lances que estão liderando lotes
            ao vivo; ele não pode ser usado em novos lances e volta ao disponível assim que você é superado.
          </p>
          <div className="wallet__columns">
            <Statement wallet={query.data} />
            {isBidder ? (
              <DepositPanel />
            ) : (
              <aside className="deposit">
                <h2 className="t-h3">Recebimentos</h2>
                <p className="t-body-s text-secondary">
                  Leiloeiros não fazem depósitos: o saldo desta conta vem do crédito dos lotes arrematados.
                </p>
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}
