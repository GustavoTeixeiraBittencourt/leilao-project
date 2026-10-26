import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "./AuthShell.css";

// Moldura das telas de Login e Cadastro (Figma: formulário à esquerda, painel de
// marca escuro à direita). No mobile só o formulário, com a marca no topo: o painel
// de marca não foi desenhado para telas pequenas.
export function AuthShell({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth__form-panel">
        <Link to="/" className="auth__logo t-h2" aria-label="ACERVO, voltar à vitrine">
          ACERVO
        </Link>
        <div className="auth__form" style={{ maxWidth: width }}>
          {children}
        </div>
      </section>

      <aside className="auth__brand" aria-hidden="true">
        <p className="t-h1">ACERVO</p>
        <div className="auth__quote">
          <span className="auth__rule" />
          <p className="t-display-l">A arte deve parecer atemporal; a disputa, ao vivo.</p>
          <p className="t-body-l">
            Leilões de obras do acervo do Art Institute of Chicago, com histórico de lances auditável por qualquer
            pessoa.
          </p>
        </div>
        <p className="t-caption">Obras do Art Institute of Chicago · saldos e lances simulados</p>
      </aside>
    </div>
  );
}
