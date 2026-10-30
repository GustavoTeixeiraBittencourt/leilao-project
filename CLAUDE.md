# Leilão Online — Contexto do Projeto

> Este arquivo é a fonte de verdade de contexto para qualquer sessão do Claude Code
> trabalhando neste repositório. Leia antes de propor ou alterar qualquer coisa.

## 0. Papel do Claude neste projeto

Engenheiro de software sênior (staff), par técnico do usuário. Trabalhar como em time real:
planejar antes de codar, commits pequenos e semânticos (Conventional Commits, em inglês),
testes E2E/integração onde há risco de regra de negócio, avisar sobre trade-offs relevantes.

- Comunicação com o usuário: **português**.
- Código, nomes de variáveis/funções, mensagens de commit: **inglês**.
- Não começar a codar sem apresentar plano (estrutura, schema, etapas) e obter OK explícito.
- Decisões ambíguas: escolher a opção mais defensável, registrar em `DECISIONS.md`, seguir.
  Só perguntar ao usuário quando a decisão for irreversível ou cara de desfazer.
- Manter `AI_USAGE.md` atualizado a cada etapa (o que foi gerado por IA, o que precisa revisão).
- Não escrever código que o usuário não consiga explicar: comentar decisões não óbvias,
  explicar trechos críticos (transação de lance, hash chain, liquidação) quando entregues.

## 1. Contexto do teste técnico

- Empresa: Verzel (processo Elite Dev).
- Prazo oficial: quinta-feira **29/10/2026**. Meta real (buffer de segurança): quarta **28/10/2026** à noite.
- Entrega: **29/10/2026** (dia do prazo oficial). Depois da entrega não pode haver commit.
- Entregáveis obrigatórios: repositório público no GitHub, **deploy público** no ar, README
  detalhado, dados de seed, relato de uso de IA (preenchido a partir de `AI_USAGE.md`).

## 2. O desafio — Casa de Leilões Online

Itens vêm da API aberta do **Cleveland Museum of Art** (CC0)
(`https://openaccess-api.clevelandart.org/api/artworks/`, imagens em `openaccess-cdn.clevelandart.org`).
A fonte original era o Art Institute of Chicago; trocada em 27/10 (ver `DECISIONS.md`; a §6 abaixo é histórico).

### 2.1 Papéis
- **LEILOEIRO**: cria/gerencia os próprios lotes. NÃO pode dar lances (bloqueado no backend).
- **LICITANTE**: deposita saldo simulado, dá lances, arremata. Cada conta tem um único papel.

### 2.2 Front-end — telas obrigatórias
1. **Vitrine**: lotes ao vivo, agendados e encerrados (cancelados nunca aparecem).
2. **Painel do leiloeiro**: buscar itens na API externa, criar lote (imagem, título, atributos,
   início/fim, lance inicial, incremento mínimo), cancelar lote sem lances, ver resultado de
   encerrados (arrematado? por quanto? total recebido).
3. **Sala do lote ao vivo**: lance atual, histórico, posição do usuário, contagem regressiva,
   "você está ganhando" / "você foi superado". Tudo via SSE, sem reload.
4. **Carteira**: saldo total, comprometido, disponível, depósito simulado.
5. **Meus arremates**: lotes vencidos, com comprovante e link compartilhável.
6. **Auditoria pública** (sem login): histórico completo de lances de um lote + veredito
   íntegro/adulterado.
7. Mensagens claras de recusa de lance: abaixo do mínimo, saldo insuficiente, já está ganhando,
   lote não iniciado, lote encerrado.

### 2.3 Back-end — regras de negócio
- **API externa instável não pode derrubar nada.** Vitrine, salas, auditoria e comprovante
  funcionam com a API externa fora do ar. Solução: *snapshot* dos dados do item no banco ao
  criar o lote; a API externa só é usada na busca do painel do leiloeiro (timeout curto,
  tratamento de erro, mensagem de degradação, cache simples opcional).
- Lance só em lote **ao vivo**. 1º lance ≥ lance inicial; seguintes ≥ lance atual + incremento.
  Líder não pode cobrir o próprio lance.
- Saldo comprometido: `disponível = total - comprometido`. Líder tem valor comprometido; se
  superado, volta ao disponível imediatamente. Lance só aceito se couber no disponível.
- **Anti-sniping**: lance aceito nos últimos 2 min → `ends_at = max(ends_at, agora + 2min)`.
- **Liquidação ao encerrar**: debita vencedor, credita leiloeiro, gera comprovante. Sem lances =
  encerra sem vencedor. Roda via worker (sem depender de tráfego) e é **idempotente**.
- **Histórico à prova de adulteração**: qualquer alteração/remoção/inserção posterior (mesmo
  direto no banco) deve ser detectável pela auditoria. Técnica explicada no README.
- **Privacidade**: auditoria e comprovante identificam licitantes só por alias pseudônimo
  estável (ex.: "Licitante #a3f9"), nunca nome/e-mail.

### 2.4 Opcionais (ordem de prioridade)
Docker Compose > testes automatizados > busca/filtro de lotes > cancelamento com estorno
automático > dark mode.

### 2.5 Fora de escopo (não fazer)
Nota fiscal, revenda, app nativo, recuperação de senha.

## 3. Stack (decidida — não rediscutir)

- **Front**: React + Vite + TypeScript (SPA), React Router, TanStack Query.
- **Back**: Node + TypeScript, Fastify, Zod.
- **Banco**: PostgreSQL, **Prisma ORM** (trocado de Drizzle em 24/10 — ver `DECISIONS.md`).
  Tudo que o `schema.prisma` não modela (triggers, índices parciais, CHECK constraints) vive em
  SQL customizado anexado à migration inicial (`prisma migrate dev --create-only` + edição manual
  antes de aplicar). Todo SQL cru do projeto (`FOR UPDATE`, `FOR UPDATE SKIP LOCKED`) fica
  concentrado em `src/db/locks.ts`, com o retorno do `$queryRaw` tipado via Zod.
- **Tempo real**: SSE com pub/sub em memória (instância única — limitação documentada). Não é WebSocket, de propósito (fluxo só servidor → navegador).
- **Documentação da API**: Swagger em `/docs` (JSON em `/docs/json`), OpenAPI escrita à mão em
  `apps/api/src/docs/openapi.ts`; os corpos vêm dos schemas Zod. **Rota nova = acrescentar ali.**
- **Auth**: e-mail + senha (argon2/bcrypt), JWT (cookie httpOnly ou Bearer); papel no token E
  revalidado no servidor.
- **Testes**: Vitest.
- **Repo**: monorepo simples (`apps/api`, `apps/web`).
- **Deploy**: front em Vercel/Netlify; back + Postgres em Render/Railway/Fly. Se o plano dormir,
  o worker fecha lotes vencidos ao subir E de forma preguiçosa ao ler um lote.

## 4. Decisões de modelagem (seguir)

- **Dinheiro**: `BIGINT` em centavos. Nunca float.
- **Tempo**: sempre relógio do servidor. Cliente só calcula contagem a partir de offset
  (`server_now` enviado nas respostas HTTP e nos eventos SSE).
- `users(id, email unique, password_hash, role 'auctioneer'|'bidder', display_name,
  public_alias unique, created_at)`.
- `wallet_entries` (ledger append-only): `id, user_id, kind ('deposit'|'settlement_debit'|
  'settlement_credit'|'refund'), amount_cents (assinado), lot_id nullable, created_at`.
  Saldo total = `SUM(amount_cents)`. Comprometido = **derivado**: soma de `current_bid_cents`
  dos lotes `open` onde o usuário é `leader_id`. `UNIQUE(lot_id, kind, user_id)` onde aplicável,
  para idempotência da liquidação.
- `lots`: `id, auctioneer_id, external_source, external_id, title, image_url,
  attributes jsonb (SNAPSHOT), starting_bid_cents, min_increment_cents, starts_at, ends_at,
  status ('open'|'closed'|'cancelled' — "agendado"/"ao vivo" são DERIVADOS do horário),
  current_bid_cents, leader_id, bid_count, winner_id, final_price_cents, closed_at,
  seal (count + hash final)`.
- `bids`: `id, lot_id, bidder_id, amount_cents, placed_at (server), seq (UNIQUE(lot_id,seq)),
  prev_hash, hash`. Append-only (trigger bloqueia UPDATE/DELETE).
- `receipts`: `id, lot_id unique, winner_id, amount_cents, public_token (aleatório), seal,
  issued_at`.
- **Hash chain**: `hash = HMAC_SHA256(AUDIT_SECRET, prev_hash || lot_id|seq|alias|amount|
  placed_at)`. `AUDIT_SECRET` em variável de ambiente, fora do banco. Hash genesis inclui os
  parâmetros do lote. Auditoria recalcula a cadeia inteira, confere `seq` contíguo, compara com
  o selo quando o lote está encerrado, retorna veredito + primeiro ponto de quebra.
- **Transação de lance** (única, `prisma.$transaction(async (tx) => ...)` com `timeout`/`maxWait`
  explícitos): `SELECT lote FOR UPDATE` → `SELECT linha do licitante FOR UPDATE` (sempre nessa
  ordem, evita deadlock; ambas via `tx.$queryRaw` em `src/db/locks.ts`, retorno tipado com Zod) →
  validar tudo (status/horário, papel, líder, mínimo, disponível) → inserir bid com hash →
  atualizar lote (current, leader, count, ends_at se anti-sniping) → commit → publicar evento
  SSE. Códigos de erro estáveis: `BID_BELOW_MIN, INSUFFICIENT_FUNDS, ALREADY_LEADING,
  LOT_NOT_STARTED, LOT_CLOSED, AUCTIONEER_CANNOT_BID`.
- **Encerramento**: worker em loop (1–2s), via `tx.$queryRaw` com `FOR UPDATE SKIP LOCKED`
  seleciona lotes `open` com `ends_at <= now()`; em uma `prisma.$transaction` (timeout/maxWait
  próprios): marca `closed`, grava selo, lança débito/crédito no ledger, cria comprovante.
  Idempotente via `UNIQUE(lot_id, kind, user_id)` + `ON CONFLICT DO NOTHING`.

## 4.1 ORM, migrations e SQL cru (Prisma)

- `prisma/schema.prisma` modela tabelas, enums, relações e índices "normais". O que ele não
  expressa — CHECK constraints, índices parciais, triggers — vai em SQL customizado anexado à
  mão no final da migration gerada por `prisma migrate dev --create-only`, antes de aplicar.
- Todo `$queryRaw`/`$executeRaw` do projeto fica concentrado em `src/db/locks.ts` (lock do lote,
  lock do licitante — nessa ordem —, seleção de lotes vencidos com `SKIP LOCKED`, leitura da
  cadeia de hash para auditoria). Retorno de `$queryRaw` sempre validado com Zod, nunca `any`.
- **Risco de drift**: depois da migration inicial, `prisma migrate dev` recalcula o diff via
  shadow DB (que reaplica todas as migrations, inclusive a customizada) contra `schema.prisma`.
  Como `schema.prisma` não sabe que CHECKs/índices parciais/triggers existem, um diff mal
  revisado pode gerar `DROP` para eles. Regra: nunca rodar `prisma migrate dev` direto depois da
  migration inicial — sempre `--create-only`, revisar o `.sql` gerado, remover à mão qualquer
  `DROP` dos objetos customizados, só então aplicar. Depois de cada migration nova, rodar
  `prisma migrate status` e `prisma migrate diff --from-migrations ./prisma/migrations
  --to-url $DATABASE_URL --script`, e avisar o usuário se algo customizado aparecer como
  removível antes de aplicar qualquer coisa.
- Deploy: `postinstall` roda `prisma generate`; start de produção roda `prisma migrate deploy`
  (nunca `migrate dev`) antes de iniciar o servidor. Seed em `prisma/seed.ts` via `prisma db seed`.
- **BigInt**: colunas de dinheiro são `BigInt` no Prisma (mapeiam para `BIGINT` do Postgres). Como
  `JSON.stringify` não serializa `bigint` nativamente, a conversão para `number` acontece só na
  borda da API (DTO de resposta) — valores em centavos desta simulação nunca chegam perto de
  `Number.MAX_SAFE_INTEGER`, então a conversão é seguro, mas é deliberada e documentada, não
  acidental.

## 5. Defesa em profundidade e limites conhecidos (vão para o README)

- Triggers bloqueiam `UPDATE`/`DELETE` em `bids` e `wallet_entries` (defesa extra, não a
  garantia principal).
- Quem tem acesso ao banco mas não ao `AUDIT_SECRET` não consegue recomputar a cadeia.
- **Limite conhecido**: em lote ainda **aberto**, remover o último lance e reverter o hash de
  cabeça não é detectável sem âncora externa; em lote **encerrado**, o selo + comprovante tornam
  isso detectável. Documentar com honestidade.
- Outras decisões a documentar: prorrogação = `max(ends_at, agora + 2min)`; empate de lance
  resolvido pela ordem da transação; cancelamento só sem lances (estorno é opcional); SSE em
  instância única (sem fan-out entre múltiplas instâncias).

## 6. Achado crítico de validação da API externa (24/10/2026)

Validação feita com `curl` e `WebFetch` **antes** de desenhar o schema/código, como pedido.

- `GET https://api.artic.edu/api/v1/artworks` e `/artworks/search` retornaram **403** a partir
  deste ambiente de desenvolvimento (IP de datacenter), com header `cf-mitigated: challenge` —
  é um **Cloudflare Managed Challenge** (JS obrigatório), não um erro de URL/formato.
  `www.artic.edu/iiif/2/...` (host de imagens) também retornou 403 pela mesma razão.
- Issue pública confirmando o padrão:
  [art-institute-of-chicago/api-data#9](https://github.com/art-institute-of-chicago/api-data/issues/9) —
  relatos de bloqueio a clientes não-navegador; em navegador real o challenge é resolvido de
  forma transparente.
- **Implicação de arquitetura**: chamadas *server-to-server* (nosso backend Fastify → API
  externa) partem de IP de datacenter/cloud e têm risco real de sofrer o mesmo bloqueio em
  produção (Render/Railway/Fly) — reforça (não é só teórico) a exigência do desafio de que a API
  externa seja tratada como instável, com timeout curto, try/catch e mensagem de degradação na
  busca do painel. Imagens servidas via `<img src="https://www.artic.edu/iiif/...">` partem do
  **browser do usuário final** (IP residencial/mobile), que normalmente resolve o challenge sem
  problema — por isso a imagem NUNCA deve ser proxeada pelo nosso backend, só a URL IIIF é
  persistida no snapshot do lote.
- **Fonte de dados real para seed**: como não dá pra confiar na API ao vivo no momento da
  demonstração, os dados de seed vêm do dump oficial aberto do museu
  (`raw.githubusercontent.com/art-institute-of-chicago/api-data`, **não** protegido por
  Cloudflare) — registros reais, com os mesmos campos da API (`id, title, image_id,
  is_public_domain, artist_display, date_display, medium_display, dimensions, credit_line,
  main_reference_number`). Confirma o formato de URL de imagem IIIF documentado:
  `https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg`.
- Campos confirmados por amostra real (artwork id 11, "Self-Portrait" de Walter Shirlaw):
  `image_id` é um UUID, `is_public_domain` é boolean, `artist_display` já vem formatado
  ("Nome (Nacionalidade, anos)"), `dimensions`/`medium_display`/`credit_line` são texto livre —
  tudo isso vai para `lots.attributes jsonb` como snapshot imutável.

## 7. Regras de qualidade

- Validação com Zod em toda entrada; erros com formato padrão `{ code, message }`.
- Autorização sempre no servidor (papel + dono do recurso).
- Sem float para dinheiro; sem confiar no relógio do cliente.
- Cada regra de negócio do desafio deve ter ao menos um teste.
- `.env.example` sempre atualizado; nunca commitar segredos.

## 8. Plano de etapas (ver `DECISIONS.md` para decisões tomadas durante a execução)

1. **Etapa 1** (hoje, 24/10): esqueleto api+web, Postgres local, migrations, auth + papéis,
   health check, deploy "hello world" no ar.
2. **Etapa 2**: núcleo de lances + carteira + anti-sniping, com testes de concorrência.
3. **Etapa 3**: worker de encerramento + liquidação idempotente + comprovante + hash chain +
   auditoria pública + seed.
4. **Etapa 4**: telas (vitrine, sala ao vivo SSE, painel do leiloeiro, carteira, meus arremates,
   mensagens de erro).
5. **Etapa 5**: Docker Compose, README, revisão final, deploy final.

Seed obrigatório: 1 leiloeiro, 2 licitantes (com saldo), ≥1 lote ao vivo com lances, 1 agendado,
1 encerrado já liquidado. Credenciais de teste no README.

## 9. Como rodar e testar localmente

**Subir o ambiente (3 terminais, da raiz do repo)**

1. Banco e dados: `pnpm db:up` (Postgres via Docker, porta 5433); depois, em `apps/api`:
   `pnpm exec prisma migrate deploy` (só na 1ª vez) e `pnpm exec prisma db seed` (reseta o banco).
   `apps/api/.env` vem de `.env.example` (JWT_SECRET e AUDIT_SECRET com 16+ chars).
2. API: `pnpm dev:api` → http://localhost:3000 (conferir `/health`).
3. Front: `pnpm dev:web` → http://localhost:5173.

**Contas de teste** (senha `demo12345`): `licitante1@demo.com` (US$ 50.000),
`licitante2@demo.com` (US$ 30.000), `leiloeiro@demo.com`.

**Testes automatizados**: `pnpm --filter @leilao/api test` (162, exigem o Postgres no ar),
`pnpm --filter @leilao/web test` (175), `pnpm lint`. Os testes da API não limpam o que criam;
o seed limpa tudo.

**Roteiro manual da Vitrine/acesso**: abas com contagem, busca (`piranesi`, depois `zzzz` para o
estado vazio), ordenação, contagem regressiva; cadastro (senha curta, e-mail repetido); login
(senha errada, recarregar mantém sessão, sair pelo avatar); `/profile` deslogado redireciona ao
login e volta. Mobile: DevTools a 390 px. Back-end sem tela:
`curl localhost:3000/lots?phase=live`, `curl localhost:3000/audit/lots/<id>`.

**Roteiro manual das demais telas** (duas janelas, uma anônima): Sala do lote (`/lots/:id`): lance
em uma janela aparece na outra sem recarregar; recusas (abaixo do mínimo, "já lidera", leiloeiro,
deslogado); derrubar a API mostra "Reconectando…". Carteira (`/wallet`): depósito e extrato; o
comprometido sobe ao liderar um lote. Meus arremates (`/wins`) com `licitante1`. Auditoria (`/audit`,
`/audit/:id`) e comprovante (`/r/<token>`, o token vem de `/wins`). Leiloeiro (`/auctioneer`,
`/auctioneer/new`): busca `piranesi` (o museu responde 403 e cai no acervo local), publicar, cancelar
lote sem lances. Mobile a 390 px: barra de lance fixa e folha na sala; tabela do painel vira cartões.
Docker: `docker compose up --build -d` sobe tudo (ver README).

**Atenção**
- Os lotes "ao vivo" do seed duram de 14 a 60 dias; os agendados abrem em ~6 e ~12 dias. Se a vitrine esvaziar, rode o seed de novo.
- Imagens IIIF do museu podem aparecer como "Imagem indisponível" (bloqueio Cloudflare/ORB visto
  em Chrome automatizado). Conferir no navegador real do usuário; o fallback já existe.
- Nunca gravar credenciais do Render (DATABASE_URL, AUDIT_SECRET) em arquivos; usar só variáveis
  de ambiente do comando.

## 10. Estado atual (29/10/2026, dia da entrega)

- Código **commitado e enviado** à `main` (último: `26e37ec` + este). Deploy: API https://leilao-api-4ogr.onrender.com
  (Swagger em `/docs`), front https://acervo-leilao.vercel.app. Conferir que o Render e a Vercel
  publicaram o commit mais recente antes de testar.
- Tudo o que o enunciado pede está implementado: Vitrine, login/cadastro, Sala do lote (SSE), Carteira, Meus
  arremates, Comprovante, Auditoria pública, Painel do leiloeiro, Novo lote e Editar lote (`PATCH /lots/:id`, só
  dono e sem lances). Opcionais feitos: busca/filtro, Docker Compose, testes (162 API + 175 front), Swagger.
- Mobile: a barra de abas inferior saiu; o ☰ do header abre um menu lateral (`<dialog>`, `Layout.tsx`, itens por
  papel em `lib/nav.ts`). A rota nova volta ao topo e cada rota define o título da aba.
- **Fora de escopo por decisão** (em `DECISIONS.md` e no README): dark mode, PWA, internacionalização, testes
  E2E de navegador, estorno de cancelamento (só cancela sem lances, então não há o que estornar).
- Bug corrigido hoje: o front mandava `Content-Type: application/json` em POST sem corpo (cancelar lote) e a API
  respondia 500. A API aceita corpo vazio e o front só declara JSON com corpo. Testar com os cabeçalhos reais do
  navegador, não só `curl`.
- Re-seed de produção já rodado (confirmado em 29/10: lotes ao vivo com `startsAt` do mesmo dia, 1 agendado, 1
  encerrado já liquidado com vencedor e preço final) e conferência VISUAL em navegador já feita pelo usuário
  (nenhuma tela foi aberta pelo Claude em nenhuma sessão). Sem pendências conhecidas antes da entrega formal.
- Figma: fileKey `TcgIkTavwQ8L6p3pWLbtkb`; carregar a skill `figma-design-to-code` antes de
  `get_design_context` (se a skill não estiver listada, ler o recurso MCP
  `skill://figma/figma-design-to-code/SKILL.md`).
