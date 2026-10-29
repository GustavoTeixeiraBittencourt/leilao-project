import type { Role } from "../api/auth";

export type NavItem = { to: string; label: string; end?: boolean };

// A navegação muda com o papel (Figma: licitante vê arremates e carteira; o
// leiloeiro vê o painel). "Auditoria" é pública e aparece para todos.
// Serve o cabeçalho do desktop e o menu lateral do mobile.
export function navItems(role: Role | null): NavItem[] {
  if (role === "bidder") {
    return [
      { to: "/", label: "Vitrine", end: true },
      { to: "/wins", label: "Meus arremates" },
      { to: "/wallet", label: "Carteira" },
      { to: "/audit", label: "Auditoria" },
    ];
  }
  if (role === "auctioneer") {
    return [
      { to: "/", label: "Vitrine", end: true },
      { to: "/auctioneer", label: "Meus lotes", end: true },
      { to: "/auctioneer/new", label: "Novo lote" },
      { to: "/audit", label: "Auditoria" },
    ];
  }
  return [
    { to: "/", label: "Vitrine", end: true },
    { to: "/audit", label: "Auditoria" },
  ];
}
