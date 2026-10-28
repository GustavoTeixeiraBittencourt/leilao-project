// Entrada de dinheiro do campo de lance. O usuário digita em dólares ("12.950,00",
// "12950", "12950,5") e a API recebe centavos INTEIROS: a conversão é feita sobre o
// texto (nunca via parseFloat), então não há erro de ponto flutuante.

// Teto igual ao da API (lance e depósito): acima disso o servidor recusaria de qualquer jeito.
export const MAX_MONEY_CENTS = 100_000_000_000;
const MAX_CENTS = MAX_MONEY_CENTS;

const THOUSANDS_ONLY = /^\d{1,3}(\.\d{3})+$/; // "12.950"
const BR_NUMBER = /^(\d{1,3}(\.\d{3})*|\d+)(,\d{1,2})?$/; // "12.950,00" | "12950,5"
const DOT_DECIMAL = /^\d+(\.\d{1,2})?$/; // "12950.5"

// Texto -> centavos, ou null se não for um valor positivo válido.
export function parseMoneyToCents(text: string): number | null {
  const s = text.replace(/US\$|\s/g, "");
  if (!s) return null;

  let normalized: string;
  if (s.includes(",")) {
    if (!BR_NUMBER.test(s)) return null;
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (THOUSANDS_ONLY.test(s)) {
    // Sem vírgula, "12.950" é 12 mil e 950 (padrão brasileiro), não 12,95.
    normalized = s.replace(/\./g, "");
  } else if (DOT_DECIMAL.test(s)) {
    normalized = s;
  } else {
    return null;
  }

  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_CENTS ? cents : null;
}

// Centavos -> texto editável do campo ("12.950,00"), sem o prefixo "US$" (o prefixo
// é um rótulo fixo ao lado do input).
export function centsToInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
}

// ---- Máscara do campo de dinheiro (MoneyInput) ----
//
// O usuário só digita números e o campo formata sozinho, como em maquininha de cartão:
// "1" -> "0,01", "100" -> "1,00", "100000" -> "1.000,00". O texto devolvido está SEMPRE
// no formato que parseMoneyToCents aceita, então o erro de "valor inválido" por formato
// deixa de existir (sobram só as regras de negócio: zero, mínimo e teto).

// 12 dígitos cobrem o teto (US$ 1.000.000.000,00 = 100.000.000.000 centavos) e ficam
// dentro do inteiro seguro do JS.
const MAX_DIGITS = 12;

// Qualquer texto digitado -> texto formatado. Tudo que não é dígito é ignorado, e zero
// (ou vazio) vira "", para o campo poder ser apagado por completo.
export function maskMoney(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_DIGITS);
  if (!digits) return "";
  return centsToInput(Math.min(Number(digits), MAX_MONEY_CENTS));
}

const US_THOUSANDS = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/; // "1,000" | "1,000.50"

// Texto COLADO -> centavos, ou null. Aceita os formatos que as pessoas realmente copiam:
// "1.000,00" (BR), "1,000.00" (US, como o campo é em dólar), "1000" e "1000.5".
// Diferente de digitar (onde os dígitos são centavos), um valor colado é lido como valor.
export function parsePastedMoney(text: string): number | null {
  const s = text.replace(/US\$|\s/g, "");
  const direct = parseMoneyToCents(s);
  if (direct !== null) return direct;
  if (US_THOUSANDS.test(s)) return parseMoneyToCents(s.replace(/,/g, ""));
  return null;
}

// Colar: tenta ler como valor; se não for um formato conhecido ("R$ 1.234,56", por
// exemplo), cai na regra de digitar e usa só os dígitos.
export function maskPastedMoney(text: string): string {
  const cents = parsePastedMoney(text);
  return cents !== null ? centsToInput(cents) : maskMoney(text);
}
