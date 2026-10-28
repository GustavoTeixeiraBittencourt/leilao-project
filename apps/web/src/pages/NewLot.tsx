import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { createLot, myAuctionsQueryKey, searchArtworks, type Artwork } from "../api/auctioneer";
import { LotImage } from "../components/LotImage";
import { serverNowMs } from "../lib/clock";
import { checkLotForm, defaultLotTimes, type LotFormErrors, type LotFormValues } from "../lib/auctioneer";
import { describeError } from "../lib/errors";
import { firstLine, formatDayAt } from "../lib/format";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { MoneyInput } from "../ui/MoneyInput";
import { Notice } from "../ui/Notice";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import "../ui/Toast.css";
import "./NewLot.css";

const MIN_QUERY = 2; // o servidor exige pelo menos 2 caracteres

function describeArtwork(item: Artwork): string {
  return [item.mediumDisplay ? firstLine(item.mediumDisplay) : null, item.isPublicDomain ? "domínio público" : null]
    .filter(Boolean)
    .join(" · ");
}

function ArtworkResult({ item, selected, onSelect }: { item: Artwork; selected: boolean; onSelect: () => void }) {
  return (
    <li className={selected ? "artwork artwork--selected" : "artwork"}>
      <LotImage src={item.imageUrl} alt="" className="artwork__image" />
      <div className="artwork__info">
        <span className="t-label-m">{item.title}</span>
        {item.artistDisplay && <span className="t-body-s text-secondary">{firstLine(item.artistDisplay)}</span>}
        <span className="t-caption text-secondary">{describeArtwork(item)}</span>
      </div>
      <Button variant="secondary" size="sm" disabled={selected} onClick={onSelect} aria-pressed={selected}>
        {selected ? "✓ Selecionada" : "Selecionar"}
      </Button>
    </li>
  );
}

function SearchPanel({ selected, onSelect }: { selected: Artwork | null; onSelect: (item: Artwork) => void }) {
  const [text, setText] = useState("");
  const [tooShort, setTooShort] = useState(false);

  const search = useMutation({ mutationFn: (q: string) => searchArtworks(q) });

  function submit(event: FormEvent) {
    event.preventDefault();
    const q = text.trim();
    if (q.length < MIN_QUERY) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    search.mutate(q);
  }

  return (
    <section className="new-lot__search" aria-labelledby="search-title">
      <h2 id="search-title" className="t-h2">
        1 · Buscar obra no acervo
      </h2>
      <p className="t-body-s text-secondary">
        A busca consulta a API pública do Cleveland Museum of Art. Ela pode ficar indisponível sem afetar lotes já
        criados.
      </p>

      <form className="search-row" onSubmit={submit} noValidate>
        <Field
          label="Título ou artista"
          value={text}
          autoComplete="off"
          hint="Ex.: Seurat, Monet, Hopper"
          error={tooShort ? `Digite pelo menos ${MIN_QUERY} caracteres.` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setTooShort(false);
          }}
        />
        <Button type="submit" variant="secondary" loading={search.isPending} className="search-row__button">
          Buscar
        </Button>
      </form>

      {search.isPending ? (
        <div aria-busy="true" className="new-lot__loading">
          <Skeleton style={{ height: 96 }} />
          <Skeleton style={{ height: 96 }} />
        </div>
      ) : search.isError ? (
        <ErrorState title="Não foi possível buscar" onRetry={() => search.mutate(text.trim())}>
          {describeError(search.error)}
        </ErrorState>
      ) : search.data ? (
        <>
          {/* O museu pode estar fora do ar (ou bloqueando o servidor): a busca degrada para o
              acervo local de reserva e avisa, em vez de falhar. Lotes já criados não dependem dele. */}
          {search.data.degraded && (
            <Notice tone="warning" icon="!" title="Acervo do museu indisponível">
              {search.data.message ?? "Mostrando algumas obras locais."}
            </Notice>
          )}
          {search.data.items.length === 0 ? (
            <EmptyState title="Nenhuma obra encontrada">
              {search.data.degraded
                ? "O acervo local de reserva tem poucas obras. Tente, por exemplo, Piranesi, Self-Portrait ou Rossini."
                : "Tente outro título ou artista."}
            </EmptyState>
          ) : (
            <ul className="new-lot__results" aria-label="Resultados da busca">
              {search.data.items.map((item) => (
                <ArtworkResult
                  key={item.externalId}
                  item={item}
                  selected={selected?.externalId === item.externalId}
                  onSelect={() => onSelect(item)}
                />
              ))}
            </ul>
          )}
        </>
      ) : (
        <EmptyState title="Busque uma obra para começar">Os resultados aparecem aqui.</EmptyState>
      )}
    </section>
  );
}

function ConfigPanel({ artwork }: { artwork: Artwork | null }) {
  const queryClient = useQueryClient();
  const initialTimes = defaultLotTimes(serverNowMs());
  const [values, setValues] = useState<LotFormValues>({
    startingBid: "",
    minIncrement: "",
    startsAt: initialTimes.startsAt,
    endsAt: initialTimes.endsAt,
  });
  const [errors, setErrors] = useState<LotFormErrors>({});
  const [published, setPublished] = useState<{ title: string; startsAt: string; live: boolean } | null>(null);

  const publish = useMutation({
    mutationFn: createLot,
    onSuccess: (result) => {
      setPublished({
        title: result.lot.title,
        startsAt: result.lot.startsAt,
        live: result.lot.phase === "live",
      });
      void queryClient.invalidateQueries({ queryKey: myAuctionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["lots"] });
    },
  });

  function set<K extends keyof LotFormValues>(key: K, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setPublished(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!artwork) return;
    // "Futuro" é decidido pelo relógio do SERVIDOR (o do navegador pode estar errado).
    const check = checkLotForm(values, serverNowMs());
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors({});
    publish.mutate({
      externalId: artwork.externalId,
      title: artwork.title,
      imageUrl: artwork.imageUrl,
      // Snapshot: a partir daqui o lote não depende mais da API do acervo.
      attributes: artwork.attributes,
      ...check.payload,
    });
  }

  return (
    <form className="config" onSubmit={submit} noValidate aria-labelledby="config-title">
      <h2 id="config-title" className="t-h2">
        2 · Configurar lote
      </h2>

      <div className="config__preview">
        {artwork ? (
          <LotImage src={artwork.imageUrl} alt={artwork.title} className="config__image" />
        ) : (
          <div className="config__image config__image--empty t-caption text-secondary">Pré-visualização</div>
        )}
        <div className="config__preview-info">
          <span className="t-overline text-secondary">Pré-visualização do lote</span>
          {artwork ? (
            <>
              <span className="t-h3">{artwork.title}</span>
              {artwork.artistDisplay && <span className="t-body-s text-secondary">{firstLine(artwork.artistDisplay)}</span>}
            </>
          ) : (
            <span className="t-body-s text-secondary">Selecione uma obra ao lado.</span>
          )}
        </div>
      </div>

      <div className="config__row">
        <MoneyInput
          label="Lance inicial (US$)"
          placeholder="4.000,00"
          value={values.startingBid}
          hint="Primeiro lance ≥ este valor"
          error={errors.startingBid}
          onValueChange={(text) => set("startingBid", text)}
        />
        <MoneyInput
          label="Incremento mínimo (US$)"
          placeholder="500,00"
          value={values.minIncrement}
          hint="Lances seguintes ≥ atual + incremento"
          error={errors.minIncrement}
          onValueChange={(text) => set("minIncrement", text)}
        />
      </div>
      <div className="config__row">
        <Field
          label="Início"
          type="datetime-local"
          value={values.startsAt}
          hint="Horário do servidor decide quando abre"
          error={errors.startsAt}
          onChange={(event) => set("startsAt", event.target.value)}
        />
        <Field
          label="Encerramento"
          type="datetime-local"
          value={values.endsAt}
          hint="Prorroga se houver lance nos últimos 2 min"
          error={errors.endsAt}
          onChange={(event) => set("endsAt", event.target.value)}
        />
      </div>

      <Notice tone="warning" icon="!">
        Ao publicar, título, artista, imagem e atributos da obra são salvos neste lote. Depois disso, ele não depende
        mais da API do acervo e esses dados não mudam.
      </Notice>

      {publish.isError && <Notice tone="danger">{describeError(publish.error)}</Notice>}

      <div className="config__actions">
        <Button type="submit" loading={publish.isPending} disabled={!artwork} className="config__publish">
          Publicar lote
        </Button>
        <Link to="/auctioneer" className="config__cancel t-label-m">
          Cancelar
        </Link>
      </div>
      {!artwork && <p className="t-caption text-secondary">Selecione uma obra para publicar.</p>}

      {published && (
        <div className="toast" role="status">
          <span className="toast__icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <p className="t-label-m">Lote publicado</p>
            <p className="t-body-s text-secondary">
              {published.live
                ? `“${published.title}” já está ao vivo na vitrine.`
                : `Abre em ${formatDayAt(published.startsAt)} e aparece em “Agendados” na vitrine.`}{" "}
              <Link to="/auctioneer" className="new-lot__link">
                Ver meus lotes
              </Link>
            </p>
          </div>
        </div>
      )}
    </form>
  );
}

export function NewLot() {
  const [artwork, setArtwork] = useState<Artwork | null>(null);

  return (
    <div className="container new-lot">
      <header className="new-lot__head">
        <h1 className="t-display-l">Novo lote</h1>
      </header>
      <div className="new-lot__columns">
        <SearchPanel selected={artwork} onSelect={setArtwork} />
        <ConfigPanel artwork={artwork} />
      </div>
    </div>
  );
}
