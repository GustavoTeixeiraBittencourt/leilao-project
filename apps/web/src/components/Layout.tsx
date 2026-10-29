import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { fetchWallet, walletQueryKey } from "../api/wallet";
import type { Role } from "../api/auth";
import { useAuth } from "../hooks/useAuth";
import { formatMoney, initial } from "../lib/format";
import { navItems } from "../lib/nav";
import "./Layout.css";

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

const DESKTOP_QUERY = "(min-width: 768px)";

// Menu lateral do mobile (entra pela direita). Usa <dialog>: o navegador cuida do foco preso,
// do Esc e do fundo (::backdrop); aqui falta só fechar ao navegar e travar a rolagem da página.
function MobileMenu() {
  const { user, logout } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Se a janela crescer até o desktop com o menu aberto, fecha (o gatilho some).
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => query.matches && dialogRef.current?.close();
    query.addEventListener("change", onChange);
    return () => {
      document.body.style.overflow = previous;
      query.removeEventListener("change", onChange);
    };
  }, [open]);

  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        className="mobile-menu-trigger"
        aria-label="Abrir menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        id={menuId}
        className="mobile-menu"
        aria-label="Menu"
        onClose={() => setOpen(false)}
        // Toque no fundo: o alvo é o próprio <dialog>, não o conteúdo.
        onClick={(event) => event.target === event.currentTarget && close()}
      >
        <div className="mobile-menu__head">
          {user ? (
            <div className="mobile-menu__who">
              <p className="t-label-m">{user.displayName}</p>
              <p className="t-caption text-secondary">
                {ROLE_LABEL[user.role]} · {user.publicAlias}
              </p>
            </div>
          ) : (
            <p className="t-label-m">ACERVO</p>
          )}
          <button type="button" className="mobile-menu__close" aria-label="Fechar menu" onClick={close}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className="mobile-menu__nav" aria-label="Navegação móvel">
          {navItems(user?.role ?? null).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="mobile-menu__link t-body-m" onClick={close}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mobile-menu__account">
          {user ? (
            <>
              <NavLink to="/profile" className="mobile-menu__link t-body-m" onClick={close}>
                Meu perfil
              </NavLink>
              <button
                type="button"
                className="mobile-menu__link t-body-m"
                onClick={() => {
                  close();
                  logout();
                }}
              >
                Sair
              </button>
            </>
          ) : (
            <NavLink to="/login" className="mobile-menu__link t-body-m" onClick={close}>
              Entrar
            </NavLink>
          )}
        </div>
      </dialog>
    </>
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
          {navItems(role).map((item) => (
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
          <MobileMenu />
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

export function Layout() {
  return (
    <div className="app">
      <a href="#conteudo" className="skip-link t-label-m">
        Ir para o conteúdo
      </a>
      <Header />
      <main id="conteudo" className="app__main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
