import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireRole } from "./components/RequireRole";
import { AuctioneerDashboard } from "./pages/AuctioneerDashboard";
import { AuditIndex } from "./pages/AuditIndex";
import { AuditLot } from "./pages/AuditLot";
import { LotRoom } from "./pages/LotRoom";
import { NewLot } from "./pages/NewLot";
import { Login } from "./pages/auth/Login";
import { Signup } from "./pages/auth/Signup";
import { NotFound } from "./pages/NotFound";
import { Profile } from "./pages/Profile";
import { ReceiptPage } from "./pages/ReceiptPage";
import { Vitrine } from "./pages/Vitrine";
import { Wallet } from "./pages/Wallet";
import { Wins } from "./pages/Wins";

// Todas as telas moram dentro do Layout (cabeçalho, rodapé, abas do mobile).
// As rotas de cada papel entram aqui conforme as telas são construídas.
export const router = createBrowserRouter([
  // Login e Cadastro ocupam a tela toda (sem cabeçalho/rodapé), como no Figma.
  { path: "/login", element: <Login /> },
  { path: "/signup", element: <Signup /> },
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Vitrine /> },
      { path: "/lots/:id", element: <LotRoom /> },
      { path: "/audit", element: <AuditIndex /> },
      { path: "/audit/:lotId", element: <AuditLot /> },
      { path: "/r/:token", element: <ReceiptPage /> },
      {
        path: "/profile",
        element: (
          <RequireRole>
            <Profile />
          </RequireRole>
        ),
      },
      {
        path: "/auctioneer",
        element: (
          <RequireRole role="auctioneer">
            <AuctioneerDashboard />
          </RequireRole>
        ),
      },
      {
        path: "/auctioneer/new",
        element: (
          <RequireRole role="auctioneer">
            <NewLot />
          </RequireRole>
        ),
      },
      {
        path: "/wins",
        element: (
          <RequireRole role="bidder">
            <Wins />
          </RequireRole>
        ),
      },
      {
        path: "/wallet",
        element: (
          <RequireRole>
            <Wallet />
          </RequireRole>
        ),
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
