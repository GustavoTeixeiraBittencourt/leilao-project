import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import type { Role } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useAuth } from "../../hooks/useAuth";
import { messageForCode } from "../../lib/errors";
import { safeRedirect } from "../../lib/redirect";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Notice } from "../../ui/Notice";
import { usePageTitle } from "../../hooks/usePageTitle";
import { AuthShell } from "./AuthShell";
import "./Signup.css";

const MIN_PASSWORD = 8; // mesmo mínimo que o servidor exige

const ROLES: { value: Role; title: string; description: string; submit: string }[] = [
  {
    value: "bidder",
    title: "Licitante",
    description: "Deposita saldo simulado, dá lances e arremata obras.",
    submit: "Criar conta de licitante",
  },
  {
    value: "auctioneer",
    title: "Leiloeiro",
    description: "Cria e gerencia os próprios lotes. Não pode dar lances.",
    submit: "Criar conta de leiloeiro",
  },
];

export function Signup() {
  usePageTitle("Criar conta · ACERVO");
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = safeRedirect((location.state as { from?: unknown } | null)?.from);

  const [role, setRole] = useState<Role>("bidder");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  if (user) return <Navigate to={redirectTo} replace />;

  const passwordTooShort = passwordTouched && password.length < MIN_PASSWORD;
  const canSubmit = displayName.trim().length >= 2 && email && password.length >= MIN_PASSWORD;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPasswordTouched(true);
    if (!canSubmit) return;
    setErrorCode(null);
    setSubmitting(true);
    try {
      await signup(email, password, displayName.trim(), role);
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setErrorCode(error instanceof ApiError ? error.code : "UNKNOWN_ERROR");
    } finally {
      setSubmitting(false);
    }
  }

  const selected = ROLES.find((item) => item.value === role)!;
  const emailTaken = errorCode === "EMAIL_ALREADY_IN_USE";

  return (
    <AuthShell width={480}>
      <div className="auth__heading">
        <h1 className="t-h1">Criar conta</h1>
        <p className="t-body-m text-secondary">
          Escolha como você vai usar o Acervo. Essa escolha define as permissões da conta.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="auth__form" noValidate>
        <fieldset className="roles">
          <legend className="sr-only">Papel da conta</legend>
          {ROLES.map((item) => (
            <label key={item.value} className={`role${role === item.value ? " role--selected" : ""}`}>
              <input
                type="radio"
                name="role"
                value={item.value}
                checked={role === item.value}
                onChange={() => setRole(item.value)}
                className="sr-only"
              />
              <span className="role__top">
                <span className="t-h3">{item.title}</span>
                <span className="t-label-m role__mark" aria-hidden="true">
                  {role === item.value ? "◉" : "○"}
                </span>
              </span>
              <span className="t-body-s text-secondary">{item.description}</span>
            </label>
          ))}
        </fieldset>

        <Notice tone="info" icon="i">
          O papel escolhido não pode ser trocado depois. Para usar o outro papel, crie outra conta com outro e-mail.
        </Notice>

        {errorCode && !emailTaken && (
          <Notice tone="danger" title="Não foi possível criar a conta">
            {messageForCode(errorCode)}
          </Notice>
        )}

        <Field
          label="Nome de exibição"
          name="displayName"
          autoComplete="name"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          hint="Visível só para você. Em telas públicas você aparece como um alias, por exemplo “Licitante #a3f9”."
        />
        <Field
          label="E-mail"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="voce@exemplo.com"
          error={emailTaken ? messageForCode("EMAIL_ALREADY_IN_USE") : undefined}
        />
        <Field
          label="Senha"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onBlur={() => setPasswordTouched(true)}
          error={passwordTooShort ? `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` : undefined}
        />
        <Button type="submit" loading={submitting}>
          {selected.submit}
        </Button>
      </form>

      <p className="auth__alt t-body-s">
        <span className="text-secondary">Já tem conta?</span>
        <Link to="/login" state={location.state} className="t-label-m">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
