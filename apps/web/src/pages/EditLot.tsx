import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchMyAuctions, myAuctionsQueryKey, updateLot, type MyLot, type UpdateLotInput } from "../api/auctioneer";
import { ArtworkSheet } from "../components/ArtworkSheet";
import { CancelLotAction } from "../components/CancelLotAction";
import { LotImage } from "../components/LotImage";
import { checkLotForm, toLocalInput, type LotFormErrors, type LotFormValues } from "../lib/auctioneer";
import { serverNowMs } from "../lib/clock";
import { describeError } from "../lib/errors";
import { firstLine, lotCode } from "../lib/format";
import { centsToInput } from "../lib/money";
import { Button, ButtonLink } from "../ui/Button";
import { Field } from "../ui/Field";
import { MoneyInput } from "../ui/MoneyInput";
import { Notice } from "../ui/Notice";
import { ErrorState, Skeleton } from "../ui/States";
import "./NewLot.css";
import "./EditLot.css";

// Obra do lote como aparece na sala (imagem, título, artista e ficha); somente leitura:
// o snapshot não muda depois de publicado.
function Snapshot({ lot }: { lot: MyLot }) {
  const artist = firstLine(lot.attributes.artist_display);
  return (
    <section className="edit-lot__artwork" aria-label="Obra do lote">
      <LotImage src={lot.imageUrl} alt={artist ? `${lot.title}, ${artist}` : lot.title} className="edit-lot__image" />
      <header className="edit-lot__title">
        <p className="t-overline text-secondary">Lote nº {lotCode(lot.id)}</p>
        <h2 className="t-h2 edit-lot__h1">{lot.title}</h2>
        {artist && <p className="t-body-l text-secondary">{artist}</p>}
      </header>
      <ArtworkSheet lot={lot} />
      <p className="t-caption text-secondary">
        Título, imagem e atributos são o registro da obra no momento da publicação e não podem ser alterados.{" "}
        <Link to={`/lots/${lot.id}`} className="new-lot__link">
          Ver a sala do lote
        </Link>
      </p>
    </section>
  );
}

function EditForm({ lot }: { lot: MyLot }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [values, setValues] = useState<LotFormValues>({
    startingBid: centsToInput(lot.startingBidCents),
    minIncrement: centsToInput(lot.minIncrementCents),
    startsAt: toLocalInput(new Date(lot.startsAt).getTime()),
    endsAt: toLocalInput(new Date(lot.endsAt).getTime()),
  });
  const [errors, setErrors] = useState<LotFormErrors>({});
  const [saved, setSaved] = useState(false);

  // Lote que já abriu não volta a "agendado": o início fica fixo.
  const started = lot.phase === "live";

  const save = useMutation({
    mutationFn: (payload: UpdateLotInput) => updateLot(lot.id, payload),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: myAuctionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["lots"] });
      void queryClient.invalidateQueries({ queryKey: ["lot", lot.id] });
    },
    // O lote pode ter recebido um lance enquanto a tela estava aberta: relê o estado real.
    onError: () => void queryClient.invalidateQueries({ queryKey: myAuctionsQueryKey }),
  });

  function set<K extends keyof LotFormValues>(key: K, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSaved(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const check = checkLotForm(values, serverNowMs());
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors({});
    const { startsAt, ...rest } = check.payload;
    save.mutate(started ? rest : { ...rest, startsAt });
  }

  return (
    <div className="edit-lot__panel">
      <form className="config" onSubmit={submit} noValidate aria-labelledby="edit-title">
        <h2 id="edit-title" className="t-h2">
          Parâmetros do leilão
        </h2>
        <div className="config__row">
          <MoneyInput
            label="Lance inicial (US$)"
            value={values.startingBid}
            hint="Primeiro lance ≥ este valor"
            error={errors.startingBid}
            onValueChange={(text) => set("startingBid", text)}
          />
          <MoneyInput
            label="Incremento mínimo (US$)"
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
            disabled={started}
            hint={started ? "O lote já está ao vivo: o início não muda" : "Horário do servidor decide quando abre"}
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

        {save.isError && <Notice tone="danger">{describeError(save.error)}</Notice>}
        {saved && (
          <Notice tone="success" icon="✓">
            Alterações salvas.
          </Notice>
        )}

        <div className="config__actions">
          <Button type="submit" loading={save.isPending} className="config__publish">
            Salvar alterações
          </Button>
          <Link to="/auctioneer" className="config__cancel t-label-m">
            Voltar
          </Link>
        </div>
      </form>

      <div className="edit-lot__danger">
        <div>
          <p className="t-label-m">Cancelar este lote</p>
          <p className="t-body-s text-secondary">
            O lote sai da vitrine e não pode ser reaberto. Só é possível enquanto não houver lances.
          </p>
        </div>
        <CancelLotAction lot={lot} onCancelled={() => navigate("/auctioneer", { replace: true })} />
      </div>
    </div>
  );
}

export function EditLot() {
  const { id } = useParams();
  const query = useQuery({ queryKey: myAuctionsQueryKey, queryFn: fetchMyAuctions });
  const lot = query.data?.lots.find((item) => item.id === id);

  return (
    <div className="container new-lot">
      <nav className="edit-lot__crumbs" aria-label="Você está em">
        <Link to="/auctioneer" className="edit-lot__back t-label-m">
          ← Meus lotes
        </Link>
      </nav>
      <header className="new-lot__head">
        <h1 className="t-display-l edit-lot__page-title">Editar lote</h1>
      </header>

      {query.isPending ? (
        <Skeleton style={{ height: 320 }} />
      ) : query.isError ? (
        <ErrorState title="Não foi possível carregar o lote" onRetry={() => void query.refetch()}>
          {describeError(query.error)}
        </ErrorState>
      ) : !lot ? (
        <ErrorState title="Lote não encontrado">
          Ele não existe ou não é seu. <Link to="/auctioneer">Voltar para meus lotes</Link>
        </ErrorState>
      ) : !lot.canCancel ? (
        <>
          <Notice tone="warning" icon="!" title="Este lote não pode mais ser editado">
            Lotes com lances, encerrados ou cancelados ficam somente para consulta.
          </Notice>
          <ButtonLink to="/auctioneer" variant="secondary">
            Voltar para meus lotes
          </ButtonLink>
        </>
      ) : (
        <div className="new-lot__columns edit-lot__columns">
          <Snapshot lot={lot} />
          <EditForm key={lot.id} lot={lot} />
        </div>
      )}
    </div>
  );
}
