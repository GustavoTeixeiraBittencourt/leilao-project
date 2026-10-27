// Entrada de dinheiro do campo de lance. O usuário digita em dólares ("12.950,00",
// "12950", "12950,5") e a API recebe centavos INTEIROS: a conversão é feita sobre o
// texto (nunca via parseFloat), então não há erro de ponto flutuante.

// Teto igual ao da API (lance e depósito): acima disso o servidor recusaria de qualquer jeito.
const MAX_CENTS = 100_000_000_000;

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
