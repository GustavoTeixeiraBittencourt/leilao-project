import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../ui/Button";

const ROLE_LABEL = { bidder: "Licitante", auctioneer: "Leiloeiro" } as const;

// A aba "Perfil" do mobile não tem tela desenhada no Figma: versão mínima, só
// o que a pessoa precisa (quem sou eu, meu alias público, sair).
export function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <div className="container" style={{ padding: "var(--space-12) var(--layout-margin)", maxWidth: 560 }}>
      <p className="t-overline text-secondary">Conta</p>
      <h1 className="t-h1" style={{ margin: "var(--space-2) 0 var(--space-6)" }}>
        {user.displayName}
      </h1>
      <dl className="t-body-m" style={{ display: "grid", gap: "var(--space-3)", margin: "0 0 var(--space-8)" }}>
        <div>
          <dt className="t-caption text-secondary">Papel</dt>
          <dd style={{ margin: 0 }}>{ROLE_LABEL[user.role]}</dd>
        </div>
        <div>
          <dt className="t-caption text-secondary">E-mail</dt>
          <dd style={{ margin: 0 }}>{user.email}</dd>
        </div>
        <div>
          <dt className="t-caption text-secondary">Seu nome público nos lances</dt>
          <dd style={{ margin: 0 }}>{user.publicAlias}</dd>
        </div>
      </dl>
      <Button
        variant="secondary"
        onClick={() => {
          logout();
          navigate("/");
        }}
      >
        Sair
      </Button>
    </div>
  );
}
