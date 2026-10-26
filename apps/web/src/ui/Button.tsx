import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import "./Button.css";

type Variant = "primary" | "secondary" | "danger";
type Size = "md" | "sm";

type CommonProps = {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

function classes(variant: Variant, size: Size, extra?: string) {
  return ["btn", `btn--${variant}`, `btn--${size}`, extra].filter(Boolean).join(" ");
}

// Botão. Em `loading` mantém a largura e mostra spinner + rótulo (regra de
// interação do Figma) e fica desabilitado: nunca dispara duas vezes.
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={classes(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: CommonProps & LinkProps) {
  return (
    <Link {...rest} className={classes(variant, size, className)}>
      {children}
    </Link>
  );
}
