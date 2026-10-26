import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireRole } from "./components/RequireRole";
import { Login } from "./pages/auth/Login";
import { Signup } from "./pages/auth/Signup";
import { NotFound } from "./pages/NotFound";
import { Profile } from "./pages/Profile";
import { Vitrine } from "./pages/Vitrine";

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
      {
        path: "/profile",
        element: (
          <RequireRole>
            <Profile />
          </RequireRole>
        ),
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
