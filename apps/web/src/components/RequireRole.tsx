import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Role } from "../api/auth";
import { useAuth } from "../hooks/useAuth";

export function PageLoading() {
  return (
    <div className="container" style={{ padding: "var(--space-12) var(--layout-margin)" }} role="status">
      <p className="t-body-m text-secondary">Carregando…</p>
    </div>
  );
}

// Guarda de rota. É só conveniência de navegação: quem manda de verdade é o servidor
// (papel no token E revalidado no banco). Esperar `status` evita mandar ao /login um
// usuário logado cuja sessão ainda está sendo restaurada após um reload.
export function RequireRole({ role, children }: { role?: Role; children: ReactNode }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <PageLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}
