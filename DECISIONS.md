# Decisões técnicas

Registro de decisões ambíguas ou de trade-off tomadas durante o desenvolvimento, com contexto e
alternativa considerada. Decisões de escopo/stack já fechadas com o usuário (ver `CLAUDE.md`) não
entram aqui — só o que exigiu uma escolha.

---

## 2026-10-24 — ORM: Prisma no lugar de Drizzle

**Decisão**: usar Prisma como ORM, abandonando a proposta inicial de Drizzle.

**Contexto**: decisão do usuário, não ambígua — ele usa Prisma no dia a dia e isso reduz risco
de execução dado o prazo curto (entrega real na quarta 28/10 à noite). Trade-off aceito: Prisma
não modela CHECK constraints, índices parciais nem triggers nativamente.

**Como resolvido**:
- `schema.prisma` cobre tabelas, enums, relações, FKs e índices simples.
- Tudo que o Prisma não expressa (triggers de append-only, índice único parcial de idempotência
  do ledger, índices parciais de performance, CHECK constraints de dinheiro/data) vai em SQL
  customizado anexado à mão no final da migration gerada com `prisma migrate dev --create-only`,
  antes de aplicar.
- Todo `$queryRaw`/`$executeRaw` concentrado em `src/db/locks.ts`, com retorno tipado via Zod.
- Risco de drift (Prisma tentar `DROP` um objeto customizado em migrations futuras) mitigado com
  a disciplina de nunca rodar `prisma migrate dev` direto após a migration inicial — sempre
  `--create-only` + revisão manual do `.sql` + `prisma migrate status`/`migrate diff` antes de
  aplicar qualquer migration nova.

**Consequência**: cada nova migration exige uma revisão manual extra (checar se o Prisma propôs
remover algo customizado). Aceitável — é um passo, não um bloqueio, e evita o risco maior de
usar uma ferramenta (Drizzle) que o usuário não tem fluência no dia a dia, sob prazo apertado.

---

## 2026-10-24 — Normalização de e-mail sem extensão `citext`

**Decisão**: `users.email` é `TEXT UNIQUE` comum; normalização para lowercase acontece na
camada de aplicação antes de qualquer `INSERT`/consulta, não no banco.

**Contexto**: `citext` resolveria unicidade case-insensitive no próprio banco, mas é uma
extensão adicional que pode não estar disponível (ou exigir permissão extra) em alguns
provedores de Postgres gerenciado (Render/Railway/Fly). Preferi reduzir dependência de infra
sob prazo curto.

**Consequência**: todo código que grava ou lê `email` deve passar por uma função única de
normalização (`toEmailKey` ou similar) — vai ter teste cobrindo isso.

---

## 2026-10-24 — Imagens da API externa nunca são proxeadas pelo backend

**Decisão**: o backend nunca faz fetch de `www.artic.edu/iiif/...` para servir a imagem — só
persiste a `image_url` (snapshot) e o frontend renderiza via `<img src>` direto, partindo do
navegador do usuário final.

**Contexto**: validação com `curl`/`WebFetch` mostrou que `api.artic.edu` e `www.artic.edu`
estão atrás de um Cloudflare Managed Challenge que bloqueia clientes não-navegador (403,
`cf-mitigated: challenge`). Chamada servidor-a-servidor (IP de datacenter) tem risco real de
cair nesse bloqueio; o navegador do usuário final (IP residencial/mobile) tipicamente resolve o
challenge de forma transparente. Ver `CLAUDE.md` seção 6 para o achado completo.

**Consequência**: vitrine/sala/auditoria nunca dependem da API externa estar no ar para mostrar
imagem — e não tem custo de proxy/stream no backend. Se por algum motivo a imagem não carregar
no navegador do usuário, o fallback de UI é mostrar um placeholder com o título do lote (snapshot
sempre disponível).

---

## 2026-10-24 — Seed usa o dump oficial aberto (GitHub), não a API ao vivo

**Decisão**: `prisma/seed.ts` usa registros reais baixados do dump oficial
(`raw.githubusercontent.com/art-institute-of-chicago/api-data`), não uma chamada à API ao vivo
no momento do seed.

**Contexto**: mesma causa da decisão acima (API externa pode estar bloqueada para clientes
não-navegador). O seed precisa ser 100% confiável no dia da avaliação, independente do estado da
API externa.

**Consequência**: o seed é determinístico e não depende de rede externa instável; o `README`
deixa claro que esses registros são reais (não fabricados), só a fonte de leitura é o dump em
vez do endpoint ao vivo.

---

## 2026-10-24 — Hash de senha com `bcryptjs` (puro JS) em vez de `argon2`

**Decisão**: usar `bcryptjs` para hash de senha, não `argon2` nem o `bcrypt` nativo (binding C).

**Contexto**: o enunciado permite "argon2 ou bcrypt". `argon2`/`bcrypt` nativos exigem
compilação via node-gyp no install — risco real de falhar silenciosamente em algum ambiente de
build do Render sob prazo curto. `bcryptjs` é uma porta pura em JS do bcrypt, mesma família de
algoritmo, zero dependência nativa.

**Consequência**: hash um pouco mais lento que a versão nativa (irrelevante no volume desta
simulação) em troca de zero risco de build quebrar no deploy.

---

## 2026-10-24 — JWT via `Authorization: Bearer`, não cookie httpOnly

**Decisão**: sessão via JWT enviado no header `Authorization: Bearer <token>`, guardado no
`localStorage` do frontend — não cookie httpOnly.

**Contexto**: o enunciado permite as duas opções. Backend (Render) e frontend (Vercel) ficam em
domínios diferentes; cookie cross-site exigiria `SameSite=None; Secure` e CORS com
`credentials: true` nos dois lados, mais superfície de coisa pra dar errado sob prazo curto.
Bearer token evita toda a complexidade de cookie cross-origin.

**Consequência**: token em `localStorage` é acessível via XSS (trade-off conhecido, aceitável
aqui porque é uma simulação sem dinheiro real e sem dados sensíveis de terceiros). Mitigação
parcial: o token nunca é logado e CORS restringe quem pode conversar com a API.
