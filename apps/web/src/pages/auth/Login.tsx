import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { useAuth } from "../../hooks/useAuth";
import { messageForCode } from "../../lib/errors";
import { safeRedirect } from "../../lib/redirect";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Notice } from "../../ui/Notice";
import { AuthShell } from "./AuthShell";

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = safeRedirect((location.state as { from?: unknown } | null)?.from);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  if (user) return <Navigate to={redirectTo} replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorCode(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setErrorCode(error instanceof ApiError ? error.code : "UNKNOWN_ERROR");
    } finally {
      setSubmitting(false);
    }
  }

  const badCredentials = errorCode === "INVALID_CREDENTIALS";

  return (
    <AuthShell width={400}>
      <div className="auth__heading">
        <h1 className="t-h1">Entrar</h1>
        <p className="t-body-m text-secondary">Acesse sua conta para dar lances ou gerenciar seus lotes.</p>
      </div>

      {errorCode && (
        <Notice tone="danger" title={badCredentials ? "E-mail ou senha incorretos" : "Não foi possível entrar"}>
          {badCredentials ? "Confira os dados e tente novamente." : messageForCode(errorCode)}
        </Notice>
      )}

      <form onSubmit={handleSubmit} className="auth__form" noValidate>
        <Field
          label="E-mail"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="voce@exemplo.com"
          hint="Usamos seu e-mail apenas para login. Ele nunca aparece em telas públicas."
          // A API responde de propósito "e-mail ou senha incorretos" (sem dizer qual):
          // marcar só a senha revelaria que o e-mail existe. Marca os dois campos.
          invalid={badCredentials}
        />
        <Field
          label="Senha"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          invalid={badCredentials}
        />
        <Button type="submit" loading={submitting} disabled={!email || !password}>
          Entrar
        </Button>
      </form>

      <p className="auth__alt t-body-s">
        <span className="text-secondary">Ainda não tem conta?</span>
        <Link to="/signup" state={location.state} className="t-label-m">
          Criar conta
        </Link>
      </p>
    </AuthShell>
  );
}
