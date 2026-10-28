import type { ChangeEvent, ClipboardEvent, FocusEvent } from "react";
import { maskMoney, maskPastedMoney } from "../lib/money";
import { Field, type FieldProps } from "./Field";

// Campo de dinheiro com máscara por centavos (ver maskMoney): a pessoa digita só números
// e o campo mostra "1.000,00". O valor que sobe para o formulário já está no formato que
// parseMoneyToCents aceita, então os validadores e o estado dos formulários não mudam.

// Handlers da máscara. Ficam soltos para também servirem num <input> de layout próprio
// (o campo de lance da sala), sem duplicar a regra.
export function moneyInputProps(onValueChange: (text: string) => void) {
  return {
    // "numeric" abre o teclado de números sem exigir vírgula ou ponto.
    inputMode: "numeric" as const,
    autoComplete: "off",
    onChange: (event: ChangeEvent<HTMLInputElement>) => onValueChange(maskMoney(event.target.value)),
    // Colar entende "1.000,00", "1,000.00" e "1000" como VALOR, não como centavos.
    onPaste: (event: ClipboardEvent<HTMLInputElement>) => {
      event.preventDefault();
      onValueChange(maskPastedMoney(event.clipboardData.getData("text")));
    },
    // Com a máscara por centavos, digitar acrescenta no fim; selecionar tudo ao focar faz o
    // primeiro dígito SUBSTITUIR o valor sugerido em vez de grudar nele. O frame de espera
    // evita que o mouseup do próprio clique desfaça a seleção.
    onFocus: (event: FocusEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      requestAnimationFrame(() => input.select());
    },
  };
}

type MoneyInputProps = Omit<FieldProps, "onChange" | "value" | "inputMode" | "type"> & {
  value: string;
  onValueChange: (text: string) => void;
};

export function MoneyInput({ onValueChange, ...field }: MoneyInputProps) {
  return <Field {...field} {...moneyInputProps(onValueChange)} />;
}
