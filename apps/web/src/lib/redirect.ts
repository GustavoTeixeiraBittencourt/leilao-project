// Para onde mandar a pessoa depois de entrar. O destino vem do `state` da navegação
// (a rota protegida em que ela estava), mas só caminhos INTERNOS são aceitos: um
// valor como "//evil.com" ou "https://evil.com" seria um redirecionamento aberto.
export function safeRedirect(target: unknown, fallback = "/"): string {
  if (typeof target !== "string") return fallback;
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return fallback;
  // Voltar para as próprias telas de acesso criaria um laço.
  if (target === "/login" || target === "/signup") return fallback;
  return target;
}
