// Unicidade de e-mail é case-insensitive na aplicação (sem extensão citext
// no banco, ver DECISIONS.md) — todo ponto de escrita/leitura de email passa
// por aqui antes de tocar o banco.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
