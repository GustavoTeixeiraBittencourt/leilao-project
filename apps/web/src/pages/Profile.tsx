import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { updateProfile, type AuthUser } from "../api/auth";
import { fetchMyAuctions, myAuctionsQueryKey } from "../api/auctioneer";
import { fetchWallet, walletQueryKey } from "../api/wallet";
import { fetchWins, winsQueryKey } from "../api/wins";
import { useAuth } from "../hooks/useAuth";
import { computeKpis } from "../lib/auctioneer";
import { describeError } from "../lib/errors";
import { formatMoney, initial } from "../lib/format";
import { checkDisplayName, MAX_NAME } from "../lib/profile";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Skeleton } from "../ui/States";
import "./Profile.css";

const ROLE_LABEL = { bidder: "Licitante", auctioneer: "Leiloeiro" } as const;

function ProfileHeader({ user }: { user: AuthUser }) {
  return (
    <header className="profile__header">
      <span className="profile__avatar" aria-hidden="true">
        {initial(user.displayName)}
      </span>
      <div className="profile__identity">
        <h1 className="t-h1 profile__name">{user.displayName}</h1>
        <p className="profile__chips">
          <span className="profile__role t-label-s">{ROLE_LABEL[user.role]}</span>
          <span className="t-body-s text-secondary">{user.publicAlias}</span>
        </p>
      </div>
    </header>
  );
}

// Dados da conta: só o nome de exibição é editável. E-mail e alias aparecem em campos
// somente leitura com a explicação do porquê, em vez de sumirem da tela.
function AccountCard({ user }: { user: AuthUser }) {
  const { updateUser } = useAuth();
  const [name, setName] = useState(user.displayName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (displayName: string) => updateProfile(displayName),
    onSuccess: ({ user: updated }) => {
      updateUser(updated); // o cabeçalho (avatar, nome) muda na hora
      setName(updated.displayName);
      setError(null);
      setSaved(true);
    },
    onError: (err) => {
      setSaved(false);
      setError(describeError(err));
    },
  });

  const dirty = name.trim() !== user.displayName;

  function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    const check = checkDisplayName(name);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    mutation.mutate(check.name);
  }

  return (
    <form className="panel" onSubmit={submit} noValidate aria-labelledby="account-title">
      <div className="panel__head">
        <h2 id="account-title" className="t-h3">
          Dados da conta
        </h2>
        <p className="t-body-s text-secondary">Só o nome de exibição pode ser alterado.</p>
      </div>

      <Field
        label="Nome de exibição"
        name="displayName"
        autoComplete="name"
        maxLength={MAX_NAME + 20} // folga para colar um texto maior e ver o erro, em vez de cortar calado
        value={name}
        error={error ?? undefined}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
          setSaved(false);
        }}
      />
      <Field label="E-mail" value={user.email} readOnly />
      <Field label="Alias público" value={user.publicAlias} readOnly />

      <div className="panel__actions">
        <Button type="submit" loading={mutation.isPending} disabled={!dirty}>
          Salvar nome
        </Button>
        <span className="t-caption profile__ok" role="status">
          {saved && "✓ Nome atualizado."}
        </span>
      </div>
    </form>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="t-overline text-secondary">{label}</span>
      <span className="t-number-m num">{value}</span>
      {hint && <span className="t-caption text-secondary">{hint}</span>}
    </div>
  );
}

function SummaryState({ pending, failed, retry, children }: { pending: boolean; failed: boolean; retry: () => void; children: React.ReactNode }) {
  if (pending) return <Skeleton style={{ height: 120 }} />;
  if (failed) {
    return (
      <div className="summary__error">
        <p className="t-body-s text-secondary">Não foi possível carregar o resumo agora.</p>
        <Button variant="secondary" size="sm" onClick={retry}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}

// Resumo por papel: reaproveita as mesmas consultas das telas de Carteira, Arremates e
// Painel (mesma chave de cache), sem endpoint novo.
function BidderSummary() {
  const wallet = useQuery({ queryKey: walletQueryKey, queryFn: fetchWallet });
  const wins = useQuery({ queryKey: winsQueryKey, queryFn: fetchWins });

  return (
    <section className="panel" aria-labelledby="summary-title">
      <div className="panel__head">
        <h2 id="summary-title" className="t-h3">
          Resumo
        </h2>
      </div>
      <SummaryState
        pending={wallet.isPending || wins.isPending}
        failed={wallet.isError || wins.isError}
        retry={() => {
          void wallet.refetch();
          void wins.refetch();
        }}
      >
        {wallet.data && wins.data && (
          <div className="stats">
            <Stat label="Disponível" value={formatMoney(wallet.data.availableCents)} hint="para novos lances" />
            <Stat label="Comprometido" value={formatMoney(wallet.data.committedCents)} hint="em lances que lideram" />
            <Stat
              label="Arremates"
              value={String(wins.data.length)}
              hint={wins.data.length === 1 ? "lote vencido" : "lotes vencidos"}
            />
          </div>
        )}
      </SummaryState>
      <div className="panel__links">
        <Link to="/wallet" className="profile__link t-label-m">
          Ir para a Carteira →
        </Link>
        <Link to="/wins" className="profile__link t-label-m">
          Ver meus arremates →
        </Link>
      </div>
    </section>
  );
}

function AuctioneerSummary() {
  const auctions = useQuery({ queryKey: myAuctionsQueryKey, queryFn: fetchMyAuctions });
  const kpis = auctions.data ? computeKpis(auctions.data.lots) : null;

  return (
    <section className="panel" aria-labelledby="summary-title">
      <div className="panel__head">
        <h2 id="summary-title" className="t-h3">
          Resumo
        </h2>
      </div>
      <SummaryState pending={auctions.isPending} failed={auctions.isError} retry={() => void auctions.refetch()}>
        {auctions.data && kpis && (
          <div className="stats">
            <Stat label="Ao vivo" value={String(kpis.live)} hint="aceitando lances" />
            <Stat label="Agendados" value={String(kpis.scheduled)} hint="ainda não abriram" />
            <Stat label="Total recebido" value={formatMoney(auctions.data.totalReceivedCents)} hint="já liquidado" />
          </div>
        )}
      </SummaryState>
      <div className="panel__links">
        <Link to="/auctioneer" className="profile__link t-label-m">
          Ver meus lotes →
        </Link>
        <Link to="/auctioneer/new" className="profile__link t-label-m">
          Criar novo lote →
        </Link>
      </div>
    </section>
  );
}

export function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <div className="container profile">
      <ProfileHeader user={user} />

      <div className="profile__main">
        <AccountCard user={user} />
        {user.role === "bidder" ? <BidderSummary /> : <AuctioneerSummary />}
        <section className="panel panel--session" aria-label="Sessão">
          <div className="panel__head">
            <h2 className="t-h3">Sessão</h2>
            <p className="t-body-s text-secondary">Encerra o acesso neste aparelho.</p>
          </div>
          <div className="panel__actions">
            <Button
              variant="secondary"
              onClick={() => {
                logout();
                navigate("/");
              }}
            >
              Sair da conta
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
