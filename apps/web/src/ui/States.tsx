import type { ReactNode } from "react";
import { Button } from "./Button";
import "./States.css";

// Estados gerais do Figma ("Carregamento, vazio, erro e degradação").

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={["skeleton", className].filter(Boolean).join(" ")} style={style} aria-hidden="true" />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="t-h3">{title}</p>
      {children && <p className="t-body-s text-secondary">{children}</p>}
    </div>
  );
}

export function ErrorState({
  title,
  children,
  onRetry,
  retryLabel = "Tentar de novo",
}: {
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="error-state" role="alert">
      <p className="t-h3">{title}</p>
      {children && <p className="t-body-m">{children}</p>}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
