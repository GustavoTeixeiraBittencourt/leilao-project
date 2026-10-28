import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { fetchWallet, walletQueryKey } from "../api/wallet";
import type { Role } from "../api/auth";
import { useAuth } from "../hooks/useAuth";
import { formatMoney, initial } from "../lib/format";
import "./Layout.css";

type NavItem = { to: string; label: string; end?: boolean };

// A navegação muda com o papel (Figma: licitante vê arremates e carteira; o
// leiloeiro vê o painel). "Auditoria" é pública e aparece para todos.
function desktopNav(role: Role | null): NavItem[] {
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

// Barra de abas do mobile (só para quem está logado).
function mobileTabs(role: Role): NavItem[] {
  return role === "bidder"
    ? [
        { to: "/", label: "Vitrine", end: true },
        { to: "/wins", label: "Arremates" },
        { to: "/wallet", label: "Carteira" },
        { to: "/profile", label: "Perfil" },
      ]
    : [
        { to: "/", label: "Vitrine", end: true },
        { to: "/auctioneer", label: "Meus lotes", end: true },
        { to: "/auctioneer/new", label: "Novo lote" },
        { to: "/profile", label: "Perfil" },
      ];
}

const ROLE_LABEL: Record<Role, string> = { bidder: "Licitante", auctioneer: "Leiloeiro" };

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha com Esc ou clique fora.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu da conta"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar t-label-m" aria-hidden="true">
          {initial(user.displayName)}
        </span>
        <span className="user-menu__burger" aria-hidden="true">
          ☰
        </span>
      </button>
      {open && (
        <div className="user-menu__panel" role="menu">
          <p className="t-label-m">{user.displayName}</p>
          <p className="t-caption text-secondary">
            {ROLE_LABEL[user.role]} · {user.publicAlias}
          </p>
          <Link to="/profile" role="menuitem" className="user-menu__item t-body-s" onClick={() => setOpen(false)}>
            Meu perfil
          </Link>
          <button
            type="button"
            role="menuitem"
            className="user-menu__item t-body-s"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
}

function Header() {
  const { user } = useAuth();
  const role = user?.role ?? null;
  const wallet = useQuery({
    queryKey: walletQueryKey,
    queryFn: fetchWallet,
    enabled: role === "bidder",
    staleTime: 15_000,
  });

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="site-header__logo t-h2" aria-label="ACERVO, página inicial">
          ACERVO
        </Link>

        <nav className="site-header__nav t-label-m" aria-label="Principal">
          {desktopNav(role).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="site-header__link">
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="site-header__user">
          {role === "bidder" && wallet.data && (
            <div className="balance">
              <span className="t-caption text-secondary">Disponível</span>
              <span className="t-label-m num">{formatMoney(wallet.data.availableCents)}</span>
            </div>
          )}
          {role === "auctioneer" && <span className="role-badge t-label-s">Leiloeiro</span>}
          {user ? (
            <UserMenu />
          ) : (
            <Link to="/login" className="site-header__login t-label-m">
              Entrar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p className="t-h2">ACERVO</p>
        <p className="t-body-s">
          Cada lote guarda uma cópia dos dados da obra, então a vitrine, as salas e a auditoria seguem no ar mesmo com
          o acervo do museu fora do ar. As imagens vêm direto do museu.
        </p>
        <p className="t-caption">Obras do acervo aberto (CC0) do Cleveland Museum of Art. Saldos, valores e lances são simulados.</p>
      </div>
    </footer>
  );
}

function TabBar() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <nav className="tab-bar" aria-label="Navegação móvel">
      {mobileTabs(user.role).map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className="tab-bar__tab t-label-s">
          <span className="tab-bar__indicator" aria-hidden="true" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Layout() {
  const { user } = useAuth();
  return (
    <div className={user ? "app app--with-tabs" : "app"}>
      <a href="#conteudo" className="skip-link t-label-m">
        Ir para o conteúdo
      </a>
      <Header />
      <main id="conteudo" className="app__main">
        <Outlet />
      </main>
      <Footer />
      <TabBar />
    </div>
  );
}
