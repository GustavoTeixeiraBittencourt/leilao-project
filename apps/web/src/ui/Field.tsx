import { useId, type InputHTMLAttributes } from "react";
import "./Field.css";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  // Mensagem de erro. Sem texto, `invalid` ainda marca o campo (borda de erro).
  error?: string;
  invalid?: boolean;
};

// Campo de formulário do Figma: rótulo, input (borda forte, 48px), ajuda e erro.
// O erro aparece em texto E na borda (nunca só cor) e é ligado ao input por
// aria-describedby para o leitor de tela anunciá-lo.
export function Field({ label, hint, error, invalid, className, ...input }: FieldProps) {
  const id = useId();
  const message = error ?? hint;
  const hasError = Boolean(error) || Boolean(invalid);

  return (
    <div className={["field", className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className="field__label t-label-m">
        {label}
      </label>
      <input
        {...input}
        id={id}
        className={["field__input", "t-body-m", hasError ? "field__input--error" : ""].filter(Boolean).join(" ")}
        aria-invalid={hasError || undefined}
        aria-describedby={message ? `${id}-msg` : undefined}
      />
      {message && (
        <p id={`${id}-msg`} className={["field__msg", "t-caption", error ? "field__msg--error" : ""].filter(Boolean).join(" ")}>
          {message}
        </p>
      )}
    </div>
  );
}
