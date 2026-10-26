import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchLots, lotsQueryKey, type ListedPhase, type Lot } from "../api/lots";
import { AuctionCard, AuctionCardSkeleton } from "../components/AuctionCard";
import { LotImage } from "../components/LotImage";
import { firstLine } from "../lib/format";
import { pickFeatured, sortLots, type SortKey } from "../lib/lots";
import { Button, ButtonLink } from "../ui/Button";
import { EmptyState, ErrorState } from "../ui/States";
import "./Vitrine.css";

const TABS: { phase: ListedPhase; label: string }[] = [
  { phase: "live", label: "Ao vivo" },
  { phase: "scheduled", label: "Agendados" },
  { phase: "ended", label: "Encerrados" },
];

const DEFAULT_SORT_LABEL: Record<ListedPhase, string> = {
  live: "Encerra primeiro",
  scheduled: "Abre primeiro",
  ended: "Mais recentes",
};

const LIST_LIMIT = 50;
const REFRESH_MS = 15_000; // a lista se atualiza sozinha (a sala do lote é que é instantânea, via SSE)

function isPhase(value: string | null): value is ListedPhase {
  return value === "live" || value === "scheduled" || value === "ended";
}

export function Vitrine() {
  const [params, setParams] = useSearchParams();
  const tab: ListedPhase = isPhase(params.get("tab")) ? (params.get("tab") as ListedPhase) : "live";
  const q = params.get("q") ?? "";
  const [sort, setSort] = useState<SortKey>("default");

  // A busca atualiza a URL com atraso de 300ms (um pedido por pausa na digitação,
  // não por tecla). O link da URL reproduz a mesma vitrine filtrada.
  const [searchText, setSearchText] = useState(q);
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchText.trim() === q) return;
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (searchText.trim()) next.set("q", searchText.trim());
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(handle);
  }, [searchText, q, setParams]);

  function selectTab(phase: ListedPhase) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (phase === "live") next.delete("tab");
        else next.set("tab", phase);
        return next;
      },
      { replace: true },
    );
    setSort("default");
  }

  const main = useQuery({
    queryKey: lotsQueryKey(tab, q, LIST_LIMIT),
    queryFn: () => fetchLots({ phase: tab, q, limit: LIST_LIMIT }),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });

  // Obra em destaque: independente da busca (sempre o lote ao vivo mais disputado).
  // Quando a aba é "ao vivo" e não há busca, é a MESMA chave da lista principal: 1 chamada.
  const hero = useQuery({
    queryKey: lotsQueryKey("live", "", LIST_LIMIT),
    queryFn: () => fetchLots({ phase: "live", limit: LIST_LIMIT }),
    refetchInterval: REFRESH_MS,
  });

  const showPreviews = tab === "live";
  const scheduled = useQuery({
    queryKey: lotsQueryKey("scheduled", q, 3),
    queryFn: () => fetchLots({ phase: "scheduled", q, limit: 3 }),
    enabled: showPreviews,
    refetchInterval: REFRESH_MS,
  });
  const ended = useQuery({
    queryKey: lotsQueryKey("ended", q, 4),
    queryFn: () => fetchLots({ phase: "ended", q, limit: 4 }),
    enabled: showPreviews,
    refetchInterval: REFRESH_MS,
  });

  const featured = useMemo(() => pickFeatured(hero.data?.lots ?? []), [hero.data]);
  const lots = useMemo(() => sortLots(main.data?.lots ?? [], sort), [main.data, sort]);
  const counts = main.data?.counts;

  function exploreLive() {
    selectTab("live");
    document.getElementById("leiloes")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <>
      <Hero featured={featured} onExplore={exploreLive} />

      <section className="vitrine__section container" id="leiloes" aria-labelledby="vitrine-tabs">
        <div className="vitrine__head">
          <nav className="vitrine__tabs" id="vitrine-tabs" aria-label="Fases dos leilões">
            {TABS.map(({ phase, label }) => (
              <button
                key={phase}
                type="button"
                className={`vitrine__tab${tab === phase ? " vitrine__tab--active" : ""}`}
                aria-pressed={tab === phase}
                onClick={() => selectTab(phase)}
              >
                <span className="t-h2">
                  {label}
                  {counts ? ` · ${counts[phase]}` : ""}
                </span>
              </button>
            ))}
          </nav>

          <div className="vitrine__tools">
            <input
              type="search"
              className="vitrine__search t-body-m"
              placeholder="Buscar por título ou artista"
              aria-label="Buscar por título ou artista"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
            <select
              className="vitrine__sort t-label-m"
              aria-label="Ordenar"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
            >
              <option value="default">{DEFAULT_SORT_LABEL[tab]}</option>
              <option value="highest">Maior lance</option>
              <option value="most-bids">Mais lances</option>
            </select>
          </div>
        </div>

        <LotList
          tab={tab}
          q={q}
          lots={lots}
          loading={main.isPending}
          error={main.isError && !main.data}
          onRetry={() => void main.refetch()}
        />
      </section>

      {showPreviews && (scheduled.data?.lots.length ?? 0) > 0 && (
        <section className="vitrine__band" aria-labelledby="em-breve">
          <div className="container vitrine__section">
            <div>
              <h2 className="t-h2" id="em-breve">
                Em breve
              </h2>
              <p className="t-body-m text-secondary">Ainda não aceitam lances. A disputa abre no horário indicado.</p>
            </div>
            <div className="vitrine__grid vitrine__grid--three">
              {scheduled.data!.lots.map((lot) => (
                <AuctionCard key={lot.id} lot={lot} />
              ))}
            </div>
          </div>
        </section>
      )}

      {showPreviews && (ended.data?.lots.length ?? 0) > 0 && (
        <section className="container vitrine__section" aria-labelledby="resultados">
          <div className="vitrine__results-head">
            <h2 className="t-h2" id="resultados">
              Resultados recentes
            </h2>
            <button type="button" className="vitrine__link t-label-m" onClick={() => selectTab("ended")}>
              Ver todos os encerrados →
            </button>
          </div>
          <div className="vitrine__grid vitrine__grid--four">
            {ended.data!.lots.map((lot) => (
              <AuctionCard key={lot.id} lot={lot} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Hero({ featured, onExplore }: { featured: Lot | null; onExplore: () => void }) {
  return (
    <section className="hero container">
      <div className="hero__text">
        <p className="t-overline hero__overline">Leilões ao vivo · Acervo Art Institute of Chicago</p>
        <h1 className="t-display-l hero__title">A arte atravessa os séculos. A disputa acontece agora.</h1>
        <p className="t-body-l text-secondary">
          Dê lances em obras do acervo de um dos grandes museus do mundo, acompanhe cada oferta em tempo real e confira
          o histórico de qualquer lote em uma auditoria pública.
        </p>
        <div className="hero__ctas">
          <Button onClick={onExplore}>Explorar leilões ao vivo</Button>
          <ButtonLink to="/audit" variant="secondary">
            Como a auditoria funciona
          </ButtonLink>
        </div>
      </div>

      {featured && (
        <Link to={`/lots/${featured.id}`} className="hero__art">
          <LotImage
            src={featured.imageUrl}
            alt={`${featured.title}, ${firstLine(featured.attributes.artist_display)}`}
            className="hero__image"
          />
          <p className="t-caption text-secondary">Obra em destaque do acervo · lote ao vivo</p>
        </Link>
      )}
    </section>
  );
}

function LotList({
  tab,
  q,
  lots,
  loading,
  error,
  onRetry,
}: {
  tab: ListedPhase;
  q: string;
  lots: Lot[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <ErrorState title="Sem conexão com o servidor" onRetry={onRetry} retryLabel="Recarregar">
        Não conseguimos atualizar os dados ao vivo. Verifique sua conexão; vamos tentar de novo automaticamente.
      </ErrorState>
    );
  }
  if (loading) {
    return (
      <div className="vitrine__grid vitrine__grid--three" aria-busy="true" aria-label="Carregando lotes">
        <AuctionCardSkeleton />
        <AuctionCardSkeleton />
        <AuctionCardSkeleton />
      </div>
    );
  }
  if (lots.length === 0) {
    return q ? (
      <EmptyState title={`Nenhum resultado para “${q}”`}>Tente buscar por outro título ou artista.</EmptyState>
    ) : (
      <EmptyState title="Nenhum lote nesta aba">
        Quando houver leilões ao vivo ou agendados, eles aparecem aqui.
      </EmptyState>
    );
  }

  // Aba "ao vivo": o primeiro lote é o destaque editorial (cartão grande); os dois
  // seguintes ficam ao lado, o segundo deslocado (como no Figma); o resto, em grade.
  if (tab === "live" && lots.length >= 2) {
    const [first, second, third, ...rest] = lots;
    return (
      <>
        <div className="vitrine__live">
          <AuctionCard lot={first!} variant="featured" />
          {second && <AuctionCard lot={second} />}
          {third && (
            <div className="vitrine__offset">
              <AuctionCard lot={third} />
            </div>
          )}
        </div>
        {rest.length > 0 && (
          <div className="vitrine__grid vitrine__grid--four">
            {rest.map((lot) => (
              <AuctionCard key={lot.id} lot={lot} />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="vitrine__grid vitrine__grid--four">
      {lots.map((lot) => (
        <AuctionCard key={lot.id} lot={lot} />
      ))}
    </div>
  );
}
