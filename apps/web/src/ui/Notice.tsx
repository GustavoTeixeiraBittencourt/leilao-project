import type { ReactNode } from "react";
import "./Notice.css";

type NoticeProps = {
  tone: "danger" | "warning" | "success" | "info";
  title?: string;
  children?: ReactNode;
  className?: string;
  // Marca à esquerda (ex.: "!" no aviso de papel). O estado nunca depende só da cor.
  icon?: string;
};

// Faixa de aviso (erro de formulário, aviso de papel, confirmação). `danger` vira
// role="alert" para o leitor de tela anunciar na hora; os demais são informativos.
export function Notice({ tone, title, children, className, icon }: NoticeProps) {
  return (
    <div
      className={["notice", `notice--${tone}`, icon ? "notice--with-icon" : "", className].filter(Boolean).join(" ")}
      role={tone === "danger" ? "alert" : "status"}
    >
      {icon && (
        <span className="notice__icon t-label-m" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="notice__body">
        {title && <p className="notice__title t-label-m">{title}</p>}
        {children && <p className="t-body-s">{children}</p>}
      </div>
    </div>
  );
}
