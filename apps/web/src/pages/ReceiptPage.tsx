import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { auditQueryKey, fetchAudit } from "../api/audit";
import { ApiError } from "../api/client";
import { fetchReceipt, receiptQueryKey } from "../api/receipts";
import { AuditSeal, type SealState } from "../components/AuditSeal";
import { LotImage } from "../components/LotImage";
import { receiptNumber } from "../lib/audit";
import { describeError } from "../lib/errors";
import { firstLine, formatIssuedAt, formatMoney, lotCode } from "../lib/format";
import { Button } from "../ui/Button";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import "./ReceiptPage.css";

function Detail({ label, children, big }: { label: string; children: React.ReactNode; big?: boolean }) {
  return (
    <div className="receipt__kv">
      <span className="t-overline text-secondary">{label}</span>
      <span className={big ? "t-number-l num" : "t-label-m"}>{children}</span>
    </div>
  );
}

// Comprovante público e compartilhável: o token do link é a credencial. Mostra só o
// snapshot guardado no banco (funciona com a API do museu fora do ar) e identifica o
// vencedor apenas pelo alias pseudônimo.
export function ReceiptPage() {
  const { token = "" } = useParams();
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);

  const receiptQuery = useQuery({ queryKey: receiptQueryKey(token), queryFn: () => fetchReceipt(token), retry: 1 });
  const receipt = receiptQuery.data;

  // O selo só vira "verificado" depois que a auditoria recalcula a cadeia do lote e ela
  // confere. Enquanto isso (ou se a auditoria falhar) o selo NÃO mostra verde.
  const lotId = receipt?.lot.id;
  const auditQuery = useQuery({
    queryKey: auditQueryKey(lotId ?? ""),
    queryFn: () => fetchAudit(lotId as string),
    enabled: Boolean(lotId),
    staleTime: 0,
    retry: 1,
  });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied("ok");
    } catch {
      // Sem permissão de área de transferência (http, iframe): a pessoa copia da barra de endereço.
      setCopied("failed");
    }
  }

  if (receiptQuery.isPending) {
    return (
      <div className="container receipt-stage">
        <Skeleton style={{ height: 520, maxWidth: 760, width: "100%" }} />
      </div>
    );
  }

  if (receiptQuery.isError || !receipt) {
    const notFound =
      receiptQuery.error instanceof ApiError &&
      (receiptQuery.error.code === "NOT_FOUND" || receiptQuery.error.code === "VALIDATION_ERROR");
    return (
      <div className="container receipt-stage">
        {notFound ? (
          <EmptyState title="Comprovante não encontrado">
            O link pode estar incompleto ou incorreto. <Link to="/">Voltar à vitrine</Link>
          </EmptyState>
        ) : (
          <ErrorState title="Não foi possível abrir o comprovante" onRetry={() => void receiptQuery.refetch()}>
            {describeError(receiptQuery.error)}
          </ErrorState>
        )}
      </div>
    );
  }

  const sealState: SealState = auditQuery.isPending
    ? "pending"
    : auditQuery.isError || !auditQuery.data
      ? "inconclusive"
      : auditQuery.data.verdict === "intact" && auditQuery.data.sealed
        ? "verified"
        : "failed";

  const artist = firstLine(receipt.lot.attributes.artist_display);

  return (
    <div className="container receipt-stage">
      <article className="receipt" aria-labelledby="receipt-title">
        <div className="receipt__top">
          <span className="t-h2 receipt__brand">ACERVO</span>
          <div className="receipt__id">
            <span className="t-overline text-secondary">Comprovante nº</span>
            <span className="t-label-m">{receiptNumber(receipt.token)}</span>
          </div>
        </div>
        <hr className="receipt__rule" />

        <h1 id="receipt-title" className="t-h1">
          Comprovante de arrematação
        </h1>

        <div className="receipt__body">
          <LotImage src={receipt.lot.imageUrl} alt={receipt.lot.title} className="receipt__image" />
          <div className="receipt__details">
            <Detail label="Obra">{artist ? `${receipt.lot.title}, ${artist}` : receipt.lot.title}</Detail>
            <Detail label="Lote">nº {lotCode(receipt.lot.id)}</Detail>
            <Detail label="Vencedor (alias público)">{receipt.winnerAlias}</Detail>
            <Detail label="Valor final" big>
              {formatMoney(receipt.amountCents)}
            </Detail>
            <Detail label="Emitido em">{formatIssuedAt(receipt.issuedAt)}</Detail>
            {/* O comprovante só existe depois que a liquidação (débito + crédito) foi concluída. */}
            <span className="receipt__settled t-label-s">✓ Liquidação concluída</span>
          </div>
        </div>

        <AuditSeal state={sealState} subtitle={`Comprovante ${receiptNumber(receipt.token)}`} />

        <Link to={`/audit/${receipt.lot.id}`} className="receipt__audit t-label-m">
          <span>Ver auditoria pública deste lote</span>
          <span aria-hidden="true">→</span>
        </Link>

        <div className="receipt__share">
          <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
            Copiar link do comprovante
          </Button>
          <span className="t-caption text-secondary" role="status">
            {copied === "ok" && "Link copiado."}
            {copied === "failed" && "Não foi possível copiar; use o endereço da barra do navegador."}
          </span>
        </div>

        <p className="t-caption text-secondary">
          Este documento identifica o vencedor somente por alias pseudônimo. Nome, e-mail e outros dados pessoais
          nunca são exibidos.
        </p>
      </article>
    </div>
  );
}
