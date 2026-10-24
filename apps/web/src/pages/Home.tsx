import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchHealth } from "../api/auth";
import { useAuth } from "../hooks/useAuth";

export function Home() {
  const { user, logout } = useAuth();
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth, refetchInterval: 10_000 });

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem", maxWidth: 640, margin: "0 auto" }}>
      <h1>Leilão Online</h1>

      <section>
        <h2>Status da API</h2>
        {health.isLoading && <p>Verificando...</p>}
        {health.isError && <p style={{ color: "crimson" }}>API indisponível.</p>}
        {health.data && (
          <p>
            <strong>{health.data.status}</strong> — relógio do servidor: {health.data.serverNow}
          </p>
        )}
      </section>

      <section>
        <h2>Sessão</h2>
        {user ? (
          <>
            <p>
              Logado como <strong>{user.displayName}</strong> ({user.role}) — alias público: {user.publicAlias}
            </p>
            <button onClick={logout}>Sair</button>
          </>
        ) : (
          <p>
            <Link to="/login">Entrar ou criar conta</Link>
          </p>
        )}
      </section>
    </main>
  );
}
