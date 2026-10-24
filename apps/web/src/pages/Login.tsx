import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import type { Role } from "../api/auth";

export function Login() {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("bidder");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await signup(email, password, displayName, role);
      }
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro inesperado");
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem", maxWidth: 420, margin: "0 auto" }}>
      <h1>{mode === "login" ? "Entrar" : "Criar conta"}</h1>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label>
          E-mail
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Senha
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        {mode === "signup" && (
          <>
            <label>
              Nome
              <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            <fieldset>
              <legend>Papel</legend>
              <label>
                <input type="radio" name="role" checked={role === "bidder"} onChange={() => setRole("bidder")} />
                Licitante
              </label>
              <label>
                <input type="radio" name="role" checked={role === "auctioneer"} onChange={() => setRole("auctioneer")} />
                Leiloeiro
              </label>
            </fieldset>
          </>
        )}

        {error && <p style={{ color: "crimson" }}>{error}</p>}

        <button type="submit">{mode === "login" ? "Entrar" : "Criar conta"}</button>
      </form>

      <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
        {mode === "login" ? "Não tem conta? Criar uma" : "Já tem conta? Entrar"}
      </button>
    </main>
  );
}
