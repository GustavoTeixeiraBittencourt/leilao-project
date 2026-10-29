import { useEffect } from "react";

export const BASE_TITLE = "ACERVO · Leilão Online";

// Título da aba (histórico, abas abertas e leitores de tela). Sem isso toda página ficava com o título do index.html.
export function usePageTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

export function titleFor(pathname: string): string | null {
  if (pathname === "/") return BASE_TITLE;
  // A sala do lote usa o nome da obra (usePageTitle na própria página).
  if (pathname.startsWith("/lots/")) return null;
  const titles: Array<[string, string]> = [
    ["/auctioneer/new", "Novo lote"],
    ["/auctioneer/lots/", "Editar lote"],
    ["/auctioneer", "Meus lotes"],
    ["/wins", "Meus arremates"],
    ["/wallet", "Carteira"],
    ["/profile", "Perfil"],
    ["/audit/", "Auditoria do lote"],
    ["/audit", "Auditoria pública"],
    ["/r/", "Comprovante"],
  ];
  const match = titles.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix));
  return `${match ? match[1] : "Página não encontrada"} · ACERVO`;
}
