import "./AuditSeal.css";

export type SealState = "verified" | "failed" | "pending" | "inconclusive";

const SEAL: Record<SealState, { mark: string; title: string; note: string }> = {
  verified: { mark: "✓", title: "Selo verificado", note: "Resultado calculado no momento da consulta" },
  failed: { mark: "×", title: "Selo não confere", note: "Resultado calculado no momento da consulta" },
  pending: { mark: "…", title: "Verificando selo", note: "Recalculando a cadeia de lances" },
  inconclusive: { mark: "?", title: "Selo não verificado", note: "Não foi possível concluir a verificação agora" },
};

// Selo do comprovante (Figma: ReceiptSeal). Só mostra "verificado" quando a auditoria
// recalculou a cadeia e ela confere com o selo gravado: o estado vem sempre do veredito
// do servidor, nunca de um dado que a própria página já tinha.
export function AuditSeal({ state, subtitle }: { state: SealState; subtitle: string }) {
  const { mark, title, note } = SEAL[state];
  return (
    <div className={`audit-seal audit-seal--${state}`} role="status">
      <div className="audit-seal__ring" aria-hidden="true">
        <span className="t-overline">ACERVO</span>
        <span className="audit-seal__mark">{mark}</span>
      </div>
      <div className="audit-seal__text">
        <p className="audit-seal__title t-label-m">{title}</p>
        <p className="t-body-s text-secondary">{subtitle}</p>
        <p className="t-caption text-secondary">{note}</p>
      </div>
    </div>
  );
}
