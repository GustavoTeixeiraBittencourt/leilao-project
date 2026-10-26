# Uso de IA neste projeto

Registro por etapa do que foi gerado com apoio de IA (Claude Code) e o que precisa de revisão
humana antes de ser levado como verdade absoluta. O usuário usa este arquivo como base para
preencher o campo "como usei IA" do processo seletivo.

## Etapa 1 — esqueleto api+web, auth, health check

**Gerado com IA:**
- Validação dos endpoints da API externa (Art Institute of Chicago) com `curl`/`WebFetch` antes
  de desenhar qualquer schema — descobriu que a API está atrás de um Cloudflare Managed
  Challenge que bloqueia clientes não-navegador (403, `cf-mitigated: challenge`), o que mudou
  duas decisões: imagens nunca são proxeadas pelo backend, e o seed usa o dump oficial aberto do
  museu no GitHub em vez da API ao vivo. Achado documentado em `CLAUDE.md` seção 6 e
  `DECISIONS.md`.
- Estrutura completa do monorepo (`apps/api`, `apps/web`, pnpm workspaces).
- `schema.prisma` completo (models, enums, relações, índices) e a migration customizada
  (CHECK constraints, índices parciais, triggers de append-only e de bloqueio de lance de
  leiloeiro) — testada manualmente contra o Postgres local (inserção direta via SQL confirmando
  que o trigger `forbid_auctioneer_bid` rejeita o caso).
- Backend Fastify: config de env com Zod, plugin de JWT/autorização por papel, tratamento de
  erro padronizado `{ code, message }`, módulo de auth (signup/login/me) com bcrypt e geração de
  alias pseudônimo.
- Frontend Vite/React: cliente HTTP, contexto de auth, páginas de login/signup e home com
  status da API em tempo real via TanStack Query.
- Arquivos de deploy (`render.yaml`, `apps/web/vercel.json`) e README com passo a passo de setup.

**O que precisa de revisão humana:**
- **Segurança dos segredos**: `JWT_SECRET`/`AUDIT_SECRET` locais foram gerados com
  `openssl rand -hex 32` e ficam só em `apps/api/.env` (não commitado) — confirmar que o Render
  gera valores próprios em produção (configurado via `generateValue: true` no `render.yaml`) e
  que eles nunca aparecem em logs.
- **Decisão de bcryptjs em vez de argon2/bcrypt nativo**: escolhida para evitar risco de
  compilação nativa no deploy sob prazo curto — validar se isso é aceitável ou se vale trocar
  por `@node-rs/argon2` depois que o deploy já estiver estável.
- **Armazenamento do JWT no frontend**: `localStorage` (Bearer token), não cookie httpOnly —
  trade-off deliberado por causa do deploy cross-origin (Vercel + Render), documentado como
  aceitável para uma simulação sem dinheiro real, mas revisar se faz sentido para o relato final.
- Revisar pessoalmente o módulo de auth (`apps/api/src/modules/auth/`) e a migration customizada
  (`apps/api/prisma/migrations/*/migration.sql`) linha a linha antes de explicar em entrevista —
  são os trechos mais "não óbvios" desta etapa.

---

## Design no Figma (2026-10-26)

**O que a IA gerou** (via servidor MCP do Figma, executando JavaScript da Plugin API):prototipação das páginas do sistema com base no wireframe de baixa compatibilidade gerada por mim e  UI/UX patterns.

**O que precisa de revisão humana:**
- Conferir se o design reflete as regras de negócio (anti-sniping, comprometido x disponível,
  cancelamento só sem lances, privacidade por alias) e se nenhuma mensagem promete algo que o
  backend não sustenta.
- Os dados exibidos (obras, valores, lances, hashes) são demonstrativos; nada ali é resultado real de verificação criptográfica.
- Contraste: foi checado só por estimativa nos tokens; rodar uma verificação real antes de
  fechar a implementação.
- Imagens são placeholders; trocar por imagens IIIF reais (ou capturas) se o design for anexado
  à entrega.

---

## Etapa 2: lances, carteira e anti-sniping (2026-10-26)

**O que a IA gerou**: `src/lib/hash-chain.ts`, `src/db/locks.ts`, `src/lib/events.ts`, módulos
`wallet`, `lots` (mínimo) e `bids` (transação de lance), correção do `tsconfig.json` (`paths` do
runtime do Prisma) e os testes `hash-chain`, `wallet`, `lots` e `bids` (38 testes no total, 19 só
de lances, incluindo concorrência).

**O que precisa de revisão humana** (explicar em entrevista):
- `src/modules/bids/service.ts`: a transação inteira. Entender por que a ordem de locks é
  lote → licitante, por que o lock do licitante existe (corrida de saldo entre lotes) e por que o
  evento SSE só sai depois do commit.
- `src/db/locks.ts`: `FOR UPDATE` e o motivo de `clock_timestamp()` no lugar de `now()`.
- `src/lib/hash-chain.ts`: o que entra no hash e por que o genesis não inclui `ends_at`.
- Anti-sniping: `ends_at = max(ends_at, agora + 2min)`; nunca encurta.
- Rodar a suíte e fazer a mutação do `lockBidder` pessoalmente para ver o teste falhar.
- Os testes não limpam o banco (ledger append-only); conferir se a estratégia serve.
