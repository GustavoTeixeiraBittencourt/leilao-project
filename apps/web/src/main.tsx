import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fontes auto-hospedadas (sem chamada a CDN): DM Serif Display para títulos, Inter para interface.
import "@fontsource/dm-serif-display/400.css";
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
