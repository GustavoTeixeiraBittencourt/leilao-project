import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  // Testes do front cobrem lógica pura (dinheiro, relógio, mensagens de erro), então
  // rodam em Node, sem DOM.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
