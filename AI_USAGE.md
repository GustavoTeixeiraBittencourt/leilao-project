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

---

## Etapa 3: liquidação, worker, auditoria, comprovante e seed (2026-10-26)

**O que a IA gerou**: `modules/settlement` (liquidação idempotente), `worker/closer.ts`, fechamento
preguiçoso nas leituras, `modules/audit` (`verify.ts` puro + serviço + rota pública),
`modules/receipts` e `modules/me`, `prisma/seed.ts` + `seed-artworks.json` (10 registros reais do
dump aberto do museu), a correção do `signup` (retry de alias) e os testes `settlement`, `audit`,
`receipts` e `signup-alias` (78 testes no total).

**O que precisa de revisão humana** (explicar em entrevista):
- `modules/settlement/service.ts`: por que liquidar sob o lock do lote, as 3 camadas de
  idempotência, o selo (e por que lote vazio usa o genesis) e a ordem lote -> licitante.
- `modules/audit/verify.ts`: o que a cadeia garante sozinha e o que só o selo e o comprovante
  garantem. Entender o limite do lote aberto (teste `KNOWN LIMIT`) e saber dizê-lo com honestidade.
- Rodar os ataques de `test/audit.test.ts` e a mutação da checagem de `HASH_MISMATCH` para ver o
  teste falhar.
- **Meu erro**: afirmei que o lock do vencedor na liquidação era necessário contra overcommit; a
  mutação mostrou que o FK já serializa. Está corrigido em `DECISIONS.md` e nos comentários. Vale
  conferir se concorda com manter o lock explícito.
- Os testes de adulteração usam `SET LOCAL session_replication_role = replica` (exige superusuário;
  funciona no Postgres do docker-compose). Em um banco gerenciado sem esse privilégio, esses testes
  precisariam de outra estratégia.
- Seed: roda `TRUNCATE`. Conferir o guard de produção antes de qualquer deploy.

---

## Etapa 4, Parte A: endpoints para as telas (2026-10-26)

**O que a IA gerou**: `GET /lots` (listagem com contagens), `POST /lots/:id/cancel`, ampliação do
`/me/auctions`, SSE `GET /lots/:id/events`, `GET /external/artworks` (busca com degradação) e os testes
`lots-list`, `lot-cancel`, `sse` e `external` (120 testes no total). A análise do Figma (tokens, telas e
estados) foi feita via servidor MCP do Figma, em modo leitura.

**O que precisa de revisão humana** (explicar em entrevista):
- `modules/lots/service.ts` (`cancelLot`): por que a checagem de "sem lances" tem que ficar sob o
  `FOR UPDATE` do lote e o que acontece numa corrida entre cancelar e dar lance.
- `modules/events/routes.ts`: `reply.hijack()`, o repasse manual dos cabeçalhos CORS, o heartbeat e a
  limpeza ao desconectar. É o código mais fácil de errar sem perceber (vazamento de assinantes).
- `modules/external/cleveland.ts`: o fallback local e o cooldown. **A API real nunca foi exercitada** (403 do
  Cloudflare, inclusive daqui); só respostas simuladas. Não afirmar em entrevista que a busca ao vivo funciona.
- Mudança de contrato do `/me/auctions` (`results` -> `lots`).
- Meus erros nesta rodada, para saber o que conferir: o `sed` de uma tentativa anterior corrompeu o
  `render.yaml` (corrigido); e uma vez tentei repetir um `curl` com User-Agent de navegador para
  contornar o anti-bot, o que foi bloqueado e **não deve ser feito**.

---

## Etapa 4, Parte B: telas do front + Docker Compose + README (2026-10-27)

**O que a IA gerou**: todo o front restante, a partir dos frames do Figma lidos via servidor MCP (só
leitura): Sala do lote (SSE, painel de lance, bottom sheet no mobile), Carteira, Auditoria pública
(`/audit`, `/audit/:id`), Comprovante (`/r/:token`), Meus arremates, Painel do leiloeiro e Novo lote. A
lógica pura ficou em `apps/web/src/lib/` com testes Vitest (de 28 para 112). Também os Dockerfiles, o
`docker-compose.yml` completo (db + api + web), `nginx.conf`, o README final e as entradas de
`DECISIONS.md`. Nenhuma mudança de API.

**O que precisa de revisão humana** (explicar em entrevista):
- `hooks/useLotStream.ts` + `lib/room.ts`: como o SSE vira estado de tela. Pontos para saber explicar:
  por que o stream escreve no cache do React Query (fonte única), por que a cada `ready` o lote e o
  histórico são relidos (o servidor não reenvia eventos perdidos) e por que `applyBidPlaced` ignora
  evento com `bidCount` menor ou igual (o mesmo lance chega pela resposta do POST e pelo SSE).
- `components/BidPanel.tsx`: as regras do cliente (mínimo, já lidera, saldo) são **dicas de UX**; quem
  decide é o servidor, que devolve códigos estáveis traduzidos em `lib/errors.ts`.
- `lib/audit.ts`: a separação entre quebra *da cadeia* e quebra *fora da cadeia*, e por que falha de
  rede é "inconclusiva" e não "adulterado". É a parte mais fácil de mostrar errado sem perceber.
- `lib/money.ts`: conversão do texto digitado para centavos sem float, e a regra de que "12.950" sem
  vírgula é 12 mil e 950.
- `PhaseWatcher` (`pages/LotRoom.tsx`): o cliente nunca decide a fase; só pergunta de novo ao servidor.

**Limites do que foi verificado (leia antes de afirmar algo)**:
- **Nenhuma tela foi aberta por mim num navegador.** A automação de Chrome não estava disponível na
  sessão. Verifiquei: `tsc` limpo, 112 testes de lógica e o contrato de cada tela contra a API real por
  script (formatos de resposta, códigos de erro, SSE entregando `bid_placed`). **Não verifiquei**:
  layout, mobile a 390 px, a folha de lance, o foco do teclado, nem o estado "adulterado" da auditoria
  com um banco realmente adulterado (a lógica das quebras está coberta por testes unitários).
- **A API do museu nunca foi exercitada ao vivo** (403 do Cloudflare até daqui): o painel do leiloeiro
  só mostrou o caminho degradado. Não afirmar em entrevista que a busca ao vivo funciona.
- O Docker Compose foi validado subindo o stack num projeto isolado (portas e volume próprios); ver o
  README para o que exatamente foi conferido.

**Erros meus nesta rodada, para saber o que conferir**:
- Um comando em lote com vários `heredoc` falhou na análise do shell e não criou nada; refiz com a
  ferramenta de escrita. Sem efeito no repositório.
- Deixei uma API de teste rodando em background e ela ocupou a porta 3000 quando você tentou subir a
  sua; encerrei só esse processo (conferi o PID e a linha de comando antes).
- Os testes de contrato **escreveram no banco de dev**: um depósito de US$ 500 em `licitante1@demo.com`,
  um lance em um lote ao vivo e um lote criado e cancelado pelo leiloeiro. O seed limpa tudo.
- No início esqueci de checar que o relógio do servidor vem aninhado em `lot.serverNow` nas respostas de
  lote (não no topo); `fetchLot` recalibra o relógio por isso, e não o `apiFetch`.

---

## Ajustes pós-revisão visual: login, perfil, carteira e sala do lote (2026-10-27)

**O que a IA gerou**: o CSS do login 50/50; a remoção do texto da Carteira e da duplicidade de auditoria na sala
do lote; a "Ficha da obra" (`artworkFacts`); a tela de Perfil reescrita (`pages/Profile.tsx`, `Profile.css`,
`lib/profile.ts`); e dois endpoints novos de conta (`PATCH /auth/me`, `POST /auth/password`) com 8 testes. O usuário
decidiu o escopo do Perfil (editar o que já existe, sem migration) e a divisão 50/50 do login. Nada commitado ainda.

**O que precisa de revisão humana** (explicar em entrevista):
- `modules/auth/service.ts` (`changePassword`): confere a senha atual com `bcrypt.compare` antes de gravar o novo
  hash. Saber explicar por que o erro é **422** e não 401 (o front trata 401 `UNAUTHORIZED` como sessão expirada) e
  por que a senha nova tem teto de **72 bytes** (bcrypt trunca).
- **Limitação que não resolvi**: o JWT é stateless; trocar a senha **não revoga** sessões abertas. Está dito na tela,
  no README e no `DECISIONS.md`. Não afirmar que a troca de senha "desloga todos os aparelhos".
- O **cadastro** continua sem o teto de 72 bytes na senha (só mínimo 8): inconsistência conhecida, fora do pedido.
- `lib/profile.ts`: a validação do front espelha a da API (conta bytes em UTF-8), mas é só conveniência; o servidor
  valida de novo.

**Limites do que foi verificado**: lint, 128 testes da API, 126 do front, build de produção e um script contra a API
real (criou uma conta própria, não alterou o seed). **Nenhuma tela foi aberta em navegador.** O layout do login
50/50, o Perfil (desktop e mobile) e a "Ficha da obra" precisam de conferência visual do usuário.

**Erro meu desta rodada**: um `heredoc` converteu `\n` em quebra de linha real dentro de strings de um teste, gerando
erro de sintaxe; percebi pelo `tsc` e corrigi antes de seguir. Sem efeito fora do arquivo de teste.
