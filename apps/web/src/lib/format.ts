// Formatação de exibição. O backend guarda dinheiro em centavos inteiros; aqui
// só se converte para texto, nunca se faz conta com float.

const number = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// O Figma usa "US$ 12.450,00": prefixo de dólar com separadores brasileiros.
export function formatMoney(cents: number): string {
  return `US$ ${number.format(cents / 100)}`;
}

const pad = (value: number) => String(value).padStart(2, "0");

// "27/10 18:00": dia/mês e hora no fuso do navegador (como na tabela do painel).
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "27/10/2026 18:00": para campos de formulário e comprovantes.
export function formatFullDateTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Os lotes têm UUID; para o "Lote Nº ..." do design usamos um código curto.
export function lotCode(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

// "27/10": só dia e mês.
export function formatDayMonth(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

// "29/10 às 14:00": quando um lote agendado abre.
export function formatDayAt(iso: string): string {
  const date = new Date(iso);
  return `${formatDayMonth(iso)} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function bidsLabel(count: number): string {
  if (count === 0) return "Sem lances";
  return count === 1 ? "1 lance" : `${count} lances`;
}

// Primeira linha do artist_display (o museu às vezes acrescenta linhas extras).
export function firstLine(text: string | null | undefined): string {
  return (text ?? "").split("\n")[0]?.trim() ?? "";
}

// "27/10 18:02:11": data curta com segundos (a auditoria mostra o horário do servidor exato).
export function formatDateTimeSeconds(iso: string): string {
  const date = new Date(iso);
  return `${formatDateTime(iso)}:${pad(date.getSeconds())}`;
}

// "27/10/2026 às 20:00:12": data de emissão do comprovante.
export function formatIssuedAt(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} às ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
