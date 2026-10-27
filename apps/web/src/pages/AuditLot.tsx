import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { auditQueryKey, fetchAudit, type AuditResult } from "../api/audit";
import { ApiError } from "../api/client";
import { AuditSeal, type SealState } from "../components/AuditSeal";
import { LotImage } from "../components/LotImage";
import {
  breakPointLabel,
  ROW_STATUS_LABEL,
  rowStatus,
  sealTail,
  shortHash,
  verdictMessage,
  verifiedCount,
} from "../lib/audit";
import { bidsLabel, formatDateTimeSeconds, formatDayAt, formatMoney, lotCode } from "../lib/format";
import { Button } from "../ui/Button";
import { EmptyState, Skeleton } from "../ui/States";
import "./AuditLot.css";

type Verdict = "intact" | "tampered" | "inconclusive";

const VERDICT_COPY: Record<Verdict, { mark: string; title: string }> = {
  intact: { mark: "✓", title: "Cadeia íntegra" },
  tampered: { mark: "!", title: "Adulteração detectada" },
  inconclusive: { mark: "?", title: "Verificação inconclusiva" },
};

function VerdictPanel({ verdict, message }: { verdict: Verdict; message: string }) {
  const { mark, title } = VERDICT_COPY[verdict];
  return (
    <div className={`verdict verdict--${verdict}`} role={verdict === "tampered" ? "alert" : "status"}>
      <span className="verdict__icon" aria-hidden="true">
        {mark}
      </span>
      <div className="verdict__text">
        <h2 className="t-h3">{title}</h2>
        <p className="t-body-s">{message}</p>
      </div>
    </div>
  );
}

function Fact({ label, value, detail, alert }: { label: string; value: string; detail?: string | null; alert?: boolean }) {
  return (
    <div className={alert ? "fact fact--alert" : "fact"}>
      <span className="t-overline text-secondary">{label}</span>
      <span className="t-label-m num">{value}</span>
      {detail && <span className="t-caption text-secondary">{detail}</span>}
    </div>
  );
}

function BidsTable({ audit }: { audit: AuditResult }) {
  if (audit.bids.length === 0) {
    return <EmptyState title="Nenhum lance registrado">Este lote ainda não recebeu lances.</EmptyState>;
  }
  return (
    <div className="audit-table__wrap">
      <table className="audit-table">
        <thead>
          <tr className="t-overline text-secondary">
            <th scope="col">Seq.</th>
            <th scope="col">Participante</th>
            <th scope="col" className="audit-table__num">Valor</th>
            <th scope="col" className="audit-table__num">Horário (servidor)</th>
            <th scope="col">Hash do lance</th>
            <th scope="col">Conferência</th>
          </tr>
        </thead>
        <tbody>
          {audit.bids.map((bid) => {
            const status = rowStatus(bid.seq, audit.firstBreak);
            return (
              <tr key={bid.seq} className={`audit-row audit-row--${status}`}>
                <td className="t-body-s text-secondary">{bid.seq}</td>
                <td className="t-label-m">{bid.bidderAlias}</td>
                <td className="audit-table__num t-label-m num">{formatMoney(bid.amountCents)}</td>
                <td className="audit-table__num t-body-s text-secondary num">{formatDateTimeSeconds(bid.placedAt)}</td>
                <td className="t-body-s text-secondary audit-table__hash" title={bid.hash}>
                  {shortHash(bid.hash)}
                </td>
                <td className={`audit-status audit-status--${status} t-label-s`}>{ROW_STATUS_LABEL[status]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Header({ lot, id, failed }: { lot?: AuditResult["lot"]; id: string; failed: boolean }) {
  const subtitle = lot
    ? [
        lot.phase === "ended"
          ? `Encerrado em ${formatDayAt(lot.endsAt)}`
          : lot.phase === "live"
            ? `Ao vivo · termina ${formatDayAt(lot.endsAt)}`
            : lot.phase === "scheduled"
              ? `Abre ${formatDayAt(lot.startsAt)}`
              : "Lote cancelado",
        bidsLabel(lot.bidCount),
      ].join(" · ")
    : null;

  return (
    <header className="audit__lot">
      {lot ? <LotImage src={lot.imageUrl} alt={lot.title} className="audit__image" /> : <Skeleton className="audit__image" />}
      <div className="audit__lot-info">
        <p className="t-overline text-secondary">Auditoria pública · Lote nº {lotCode(id)}</p>
        <h1 className="t-display-l audit__title">{lot ? lot.title : failed ? "Auditoria do lote" : "Carregando…"}</h1>
        {subtitle && <p className="t-body-m text-secondary">{subtitle}</p>}
        <Link to={`/lots/${id}`} className="audit__room-link t-label-m">
          Ver a sala do lote →
        </Link>
      </div>
    </header>
  );
}

const HOW_TO_READ =
  "Cada lance carrega uma “impressão digital” que depende do lance anterior. Recalculamos toda a cadeia com um segredo guardado fora do banco de dados: se qualquer lance for alterado, removido ou inserido depois, a impressão deixa de bater a partir daquele ponto. Participantes aparecem apenas por alias pseudônimo. Em lotes ainda abertos, a conferência vale até o último lance registrado; após o encerramento, o selo final também é comparado.";

export function AuditLot() {
  const { lotId = "" } = useParams();
  // Sem cache de resultado: cada visita recalcula a cadeia (o veredito é sempre "de agora").
  const query = useQuery({ queryKey: auditQueryKey(lotId), queryFn: () => fetchAudit(lotId), staleTime: 0, retry: 1 });

  const notFound =
    query.error instanceof ApiError && (query.error.code === "NOT_FOUND" || query.error.code === "VALIDATION_ERROR");

  if (notFound) {
    return (
      <div className="container audit-state">
        <EmptyState title="Lote não encontrado">
          Não existe um lote com este código. <Link to="/audit">Ver os lotes auditáveis</Link>
        </EmptyState>
      </div>
    );
  }

  const audit = query.data;
  // Falha ao consultar (rede, servidor, banco) NÃO é adulteração: o painel diz isso.
  const inconclusive = query.isError;

  const verdict: Verdict | null = audit ? audit.verdict : inconclusive ? "inconclusive" : null;
  const brk = audit ? breakPointLabel(audit.firstBreak) : null;

  const sealState: SealState | null = audit?.sealed
    ? audit.verdict === "intact"
      ? "verified"
      : "failed"
    : null;

  return (
    <div className="container audit">
      <Header lot={audit?.lot} id={lotId} failed={inconclusive} />

      {verdict === null ? (
        <Skeleton style={{ height: 110 }} />
      ) : (
        <div className="audit__verdict-row">
          <VerdictPanel
            verdict={verdict}
            message={
              audit
                ? verdictMessage(audit)
                : "Não foi possível concluir a verificação agora. Isso não indica adulteração. Tente novamente."
            }
          />
          {sealState && audit && <AuditSeal state={sealState} subtitle="Selo gravado no encerramento do lote" />}
        </div>
      )}

      {inconclusive && (
        <div>
          <Button variant="secondary" onClick={() => void query.refetch()} loading={query.isFetching}>
            Verificar de novo
          </Button>
        </div>
      )}

      <div className="audit__facts">
        <Fact label="Lances verificados" value={audit ? `${verifiedCount(audit)} de ${audit.bids.length}` : "—"} />
        <Fact
          label="Primeiro ponto de quebra"
          value={brk ? brk.value : "Nenhum"}
          detail={brk?.detail}
          alert={audit?.verdict === "tampered"}
        />
        <Fact
          label="Selo final do lote"
          value={
            audit?.seal ? `${audit.seal.count ?? "?"} lances · ${sealTail(audit.seal.hash)}` : audit ? "Ainda não selado" : "—"
          }
          detail={audit && !audit.seal ? "O selo é gravado quando o lote encerra" : null}
        />
        <Fact
          label="Verificado em"
          value={audit ? `${formatDayAt(audit.serverNow)} (agora)` : inconclusive ? "Não concluído" : "—"}
        />
      </div>

      {audit && (
        <section className="audit__table-block" aria-labelledby="audit-table-title">
          <h2 id="audit-table-title" className="t-h2">
            Histórico completo e ordenado
          </h2>
          <BidsTable audit={audit} />
        </section>
      )}

      <section className="audit__howto">
        <h2 className="t-h3">Como ler este resultado</h2>
        <p className="t-body-m">{HOW_TO_READ}</p>
      </section>
    </div>
  );
}
