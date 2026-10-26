import { ButtonLink } from "../ui/Button";

export function NotFound() {
  return (
    <div className="container" style={{ padding: "var(--space-24) var(--layout-margin)", maxWidth: 560 }}>
      <p className="t-overline text-secondary">Erro 404</p>
      <h1 className="t-h1" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
        Página não encontrada
      </h1>
      <p className="t-body-l text-secondary" style={{ marginBottom: "var(--space-8)" }}>
        O endereço pode ter mudado ou o lote não existe mais.
      </p>
      <ButtonLink to="/">Voltar à vitrine</ButtonLink>
    </div>
  );
}
