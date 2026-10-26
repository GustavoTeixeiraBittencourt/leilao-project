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

---

## 2026-10-26 — Design das telas no Figma antes da Etapa 4 (marca provisória "ACERVO")

**Decisão**: desenhar o design system e as 8 áreas funcionais no Figma antes de implementar o
frontend, com identidade editorial própria (papel `#F5F1E8`, carvão `#24251F`, óxido `#8B382D`;
DM Serif Display para títulos, Inter para interface e números). "ACERVO" é nome conceitual
provisório, sem verificação de disponibilidade comercial.

**Contexto**: o arquivo `Leilão Online – UI` tem 4 páginas (Foundations, Components, Product
Screens, Prototype & States). Tokens viraram variáveis do Figma com a mesma estrutura que deve
virar CSS custom properties no React (`--color-bg-page`, `--space-4`, `--radius-md`…), com
modos Light/Dark (só o claro foi desenhado ate o momento da prototpação do frontend). Cada componente de leilão (BidPanel, Countdown,
BidHistory, AuditVerdict, ReceiptSeal…) tem variantes que espelham os estados de negócio e os
códigos de erro estáveis do backend (`BID_BELOW_MIN`, `INSUFFICIENT_FUNDS`, `ALREADY_LEADING`,
`LOT_NOT_STARTED`, `LOT_CLOSED`, `AUCTIONEER_CANNOT_BID`).

**Consequências e limites conhecidos**:
- Imagens das obras são placeholders rotulados: o plugin do Figma não busca URLs externas e a
  API do museu bloqueia clientes não-navegador (ver seção 6 do `CLAUDE.md`). Na implementação a
  imagem é `<img>` IIIF carregada pelo browser, com fallback (variante "Image unavailable").
- Valores, lances, horários, hashes e selos do protótipo são **demonstrativos**; as telas de
  auditoria e comprovante dizem isso explicitamente. O selo "verificado" só pode aparecer quando
  a auditoria real recalcular a cadeia e ela conferir.
- Mobile foi desenhado para Vitrine e Sala do lote (incluindo painel de lance em bottom sheet);
  as demais telas foram desenhadas só em desktop.
- Painel de lance é `position: sticky` no desktop e barra fixa no rodapé no mobile (anotado nas
  camadas do Figma). A coluna comprometida da carteira não aparece no extrato porque é derivada
  dos lotes em que o usuário lidera (regra do `CLAUDE.md` seção 4).
- Duas instâncias foram desanexadas no mobile (galeria com imagem de 300px e histórico com
  colunas compactas) porque o Figma não permite redimensionar filhos de instância; na
  implementação isso é só CSS responsivo.
- O prototype navegável existe só dentro da página "Product Screens" (o Figma não liga páginas
  diferentes); a página "Prototype & States" reúne os estados e um índice de fluxos.

---

## 2026-10-26 — Etapa 2: lances, carteira e anti-sniping

**Decisões**:
- **Hash chain entrou na Etapa 2** (e não na 3): `bids.prev_hash/hash` são NOT NULL, então todo
  lance já nasce encadeado. Em `src/lib/hash-chain.ts` ficam só o genesis e o hash por lance; a
  *auditoria* (recalcular a cadeia, comparar com o selo, achar o ponto de quebra) continua na Etapa 3.
- **Genesis exclui `ends_at`**: o anti-sniping altera `ends_at` depois da criação, então o genesis
  usa só campos imutáveis (`lotId`, `auctioneerId`, lance inicial, incremento, `startsAt`).
- **`placed_at` = `clock_timestamp()` do banco, lido DEPOIS dos locks**. `now()` devolveria o início
  da transação (defasado se o lance esperou na fila). O `Date` do JS trunca para ms, igual à coluna
  `Timestamptz(3)`, então o instante assinado no hash é exatamente o gravado.
- **Papel validado no banco**: o `lockBidder` devolve o `role` da linha do usuário; a rota usa só
  `authenticate` (sem `requireRole("bidder")`) para o leiloeiro receber `AUCTIONEER_CANNOT_BID`
  (código estável) em vez de um `FORBIDDEN` genérico.
- **Ordem de validação**: papel → lote fechado/cancelado/vencido → não iniciado → já lidera →
  abaixo do mínimo → saldo. Lote vencido (open com `ends_at <= now`, ainda sem worker) conta como
  `LOT_CLOSED`.
- **Depósito**: teto de R$ 1.000.000,00 por operação (`MAX_DEPOSIT_CENTS`), só licitante.
- **`POST /lots` é mínimo**: existe para criar lotes de teste/seed; exige `endsAt` futuro. Painel
  completo, busca na API externa e cancelamento ficam para a Etapa 4. `GET /lots/:id` é público.
- **Tempo real**: `src/lib/events.ts` é pub/sub em memória; o lance publica `bid_placed` *após* o
  commit. O endpoint SSE em si entra na Etapa 4.

**Regra para a Etapa 3**: o worker de liquidação deve pegar os locks na MESMA ordem
(lote → licitante) que o lance; ver `src/db/locks.ts`.

**Tooling — achado**: o client gerado do Prisma importa `@prisma/client/runtime/library.js`, mas o
`exports` do pacote só declara `./runtime/library`. Com `moduleResolution: NodeNext` o import não
resolvia e, com `skipLibCheck`, o erro ficava mudo: `Prisma.TransactionClient` e o `tx` de
`$transaction` viravam `{}`. Corrigido com `paths` no `tsconfig.json`. Se o `tx` perder o
autocompletar de novo, olhar aqui primeiro.

**Testes**: não apagam o que criam (`wallet_entries`/`bids` são append-only e têm FK), usam ids e
e-mails únicos. Isso deixa lixo no banco de dev; o seed da Etapa 3 deve resetar o banco. Se
incomodar, a alternativa é um banco `leilao_test` separado.

**Validação por mutação**: removendo o `lockBidder` de propósito, o teste de lances simultâneos em
5 lotes com saldo para 1 passa a aceitar os 5 (comprometimento acima do saldo). Ou seja, o teste
de concorrência de fato protege essa regra.

---

## 2026-10-26 — Etapa 3: liquidação, worker, auditoria, comprovante e seed

**Decisões**:
- **Sem migration nova**: `receipts`, o selo em `lots` e o índice parcial de idempotência já
  existiam. Nenhum risco de drift do Prisma nesta etapa.
- **Liquidação em 3 camadas de idempotência**: (1) sob o lock do lote só liquida se ainda está `open`
  e vencido; (2) ledger com `ON CONFLICT DO NOTHING` no índice `(lot_id, kind, user_id)`
  (`createMany({ skipDuplicates })`); (3) `UNIQUE(lot_id)` no comprovante.
- **Selo de lote sem lances = hash genesis** (`seal_count = 0`): um lance injetado depois num lote
  vazio quebra a conferência.
- **Worker** (`src/worker/closer.ts`): `setTimeout` encadeado (ticks não se sobrepõem), primeiro tick
  imediato (cobre plano que dorme), cada lote em transação própria, `FOR UPDATE SKIP LOCKED`. Sobe em
  `server.ts`, não em `buildApp()`, para os testes controlarem a liquidação. `WORKER_INTERVAL_MS`
  (padrão 1500).
- **Fechamento preguiçoso** só nas leituras de UM lote (`GET /lots/:id`, `/lots/:id/bids`, auditoria),
  nunca na listagem: uma leitura em massa não deve disparar várias liquidações.
- **Auditoria**: leitura de lote + comprovante + cadeia em transação `REPEATABLE READ` (mesmo
  snapshot), senão um lance no meio vira falso "adulterado". Retorna no primeiro ponto de quebra, com
  `seq` e motivo (`SEQ_GAP`, `PREV_HASH_MISMATCH`, `HASH_MISMATCH`, `BID_COUNT_MISMATCH`,
  `LOT_SUMMARY_MISMATCH`, `SEAL_MISMATCH`, `RECEIPT_MISMATCH`).
- **Total recebido do leiloeiro** = soma dos `settlement_credit` do ledger.
- **Seed**: 10 obras reais do dump aberto do museu salvas em `prisma/seed-artworks.json` (sem rede).
  Lotes encerrados passam pelo código real (`placeBid` -> `settleLot`), então a auditoria dá íntegro;
  o seed audita tudo no final e falha se algo não fechar. Reseta o banco com `TRUNCATE`; em produção
  só com `ALLOW_SEED_RESET=1`. Exceção consciente à regra "SQL cru só em `locks.ts`": o `TRUNCATE` do
  seed, que é script de desenvolvimento e não código de runtime.
- **`pnpm lint` agora checa `prisma/seed.ts` e `test/`** (`tsconfig.check.json`); antes só `src/`.

**Correção de uma afirmação minha (importante)**: eu disse que, sem `lockBidder` na liquidação,
um vencedor poderia se comprometer acima do saldo. Testei removendo o lock e o teste de espera
continuou passando: o FK do débito em `wallet_entries` já toma `FOR KEY SHARE` na linha do usuário,
que conflita com o `FOR UPDATE` do lance, e isso serializa do mesmo jeito. Mantive o lock explícito
(a regra de ordem lote -> licitante fica visível e não depende de efeito colateral de FK), mas o
teste `waits for the winner's row lock` **não prova que o lock explícito existe**; ele guarda o
comportamento. O teste de estresse com lances simultâneos é best effort (janela de submilissegundos).
Isto é diferente do lock do licitante no LANCE, que a mutação comprovou ser necessário (Etapa 2).

**Bug real achado e corrigido (fora do escopo, por causa de um flake)**: `public_alias` tem só 4 hex
(65.536 valores) e é `UNIQUE`; uma colisão no `signup` devolvia 500. Reproduzido com um teste
determinístico (gerador mockado) e corrigido com retry (até 5 tentativas); colisão de e-mail em
corrida agora vira `EMAIL_ALREADY_IN_USE`. Com muitos usuários o espaço de 4 hex continua pequeno:
se o projeto crescer, aumentar o sufixo.

**Limites conhecidos (vão para o README)**:
- Lote **aberto**: remover o último lance E reescrever `bid_count`/lance atual/líder não é
  detectável sem âncora externa. Existe um teste que documenta isso (`KNOWN LIMIT`). Lote
  **encerrado** é protegido pelo selo e pelo comprovante.
- O hash inclui o `public_alias` (tabela `users`), então editar o alias de um usuário também aparece
  como `HASH_MISMATCH`.
- Se `bid_count` divergir da cadeia no fechamento, `settleLocked` lança erro e o lote não é
  liquidado; o worker tentará de novo a cada tick (ruído de log, nunca liquidação sobre dado
  inconsistente).
- `closeIfDue` compara com o relógio da aplicação; a liquidação em si decide pelo relógio do banco
  (no pior caso a leitura chama `settleLot` que vira no-op).

**Dev**: o banco de dev acumula dados dos testes (ledger append-only). Rodar `pnpm prisma:seed`
limpa tudo.

---

## 2026-10-26 — Etapa 4, Parte A: endpoints que as telas exigem

Revisão do plano depois de ver o Figma: os tokens, componentes e estados já estavam desenhados, então
a Parte A ficou menor (4 entregas) e cada tela do front só consome o que já existe.

**Decisões**:
- **`GET /lots`** (vitrine, público): sem paginação; `phase` (`live|scheduled|ended`), `q`, `limit` (1–50)
  e **contagens por fase** sempre (as abas do mobile mostram "Ao vivo · 6"). Sem `phase` devolve só as
  contagens. Fases derivadas do horário; `ended` inclui `open` vencido. **Cancelado nunca aparece**,
  nem nas contagens. Sem fechamento preguiçoso na listagem (uma leitura em massa não dispara várias
  liquidações). `lotDto` ganhou `winnerAlias` e `finalPriceCents`.
- **Busca por título/artista em SQL cru** (`searchLotIds` em `db/locks.ts`) com
  `position(lower(q) in lower(...))`. Dois defeitos do Prisma encontrados pelos testes: o filtro JSON não
  tem modo insensitive e o `contains` **não escapa `%` e `_`** (digitar `%` casaria tudo). Escala: a
  busca traz os ids e o resto segue em Prisma; num catálogo grande viraria coluna indexada.
- **`POST /lots/:id/cancel`**: só o dono, só lote aberto (agendado ou ao vivo) e **sem lances**, checado
  sob o `FOR UPDATE` do lote (o mesmo do lance: ou o lance entra e o cancelamento recebe
  `LOT_HAS_BIDS`, ou o cancelamento entra e o lance recebe `LOT_CLOSED`). Códigos novos:
  `LOT_HAS_BIDS` e `LOT_NOT_CANCELLABLE` (409). Sem lances não há dinheiro comprometido: sem estorno.
  Publica `lot_cancelled` no SSE.
- **`GET /me/auctions` mudou de contrato**: agora devolve **todos** os lotes do leiloeiro (`lots`, com
  fase, resultado, `sold` e `canCancel`) em vez de só os encerrados (`results`). `canCancel` espelha a
  regra para a UI não duplicá-la; quem decide é o servidor.
- **SSE `GET /lots/:id/events`**: público (o `EventSource` não envia `Authorization` e os eventos só têm
  dados públicos). Eventos `ready`, `bid_placed`, `lot_closed`, `lot_cancelled` e `ping` (a cada 20 s,
  com `serverNow` para recalibrar o relógio da contagem). Eventos perdidos numa queda **não** são
  reenviados: o cliente refaz a leitura do lote e do histórico ao reconectar.
- **`forceCloseConnections: true`** no Fastify: sem isso `app.close()` (SIGTERM no deploy) ficava
  pendurado esperando conexões SSE que nunca terminam. Reproduzido por teste antes da correção.
- **Busca no catálogo do museu `GET /external/artworks`** (só leiloeiro): timeout de 3 s, cache de 10 min,
  **cooldown de 30 s** após falha (senão toda busca esperaria o timeout) e **fallback local** (as 10
  obras reais do seed, em `src/data/fallback-artworks.json`, movido de `prisma/`) com
  `degraded: true` e `reason` (`timeout|unavailable`). Nunca devolve 5xx por falha externa.

**Achado importante, sobre a API externa**: confirmado agora com `curl` (User-Agent honesto, 26/10): a
API do museu responde **403 com `Cf-Mitigated: challenge`** (Cloudflare Managed Challenge) **até daqui,
de IP residencial**. Logo, a busca server-to-server deve cair no fallback local em produção, e o painel
vai mostrar a degradação o tempo todo. O código está correto e testado (inclusive o mapeamento do
formato real), mas **o caminho "API respondendo" nunca foi exercitado contra a API de verdade**; só
contra respostas simuladas no formato documentado. Não contorno o desafio (nem com User-Agent de
navegador): é uma verificação anti-bot e a decisão de projeto já era tratá-la como API instável.
Alternativa a avaliar na Parte B: buscar direto do navegador do leiloeiro (CORS e o desafio precisam
ser testados num navegador real; não há garantia de que funcione).

**Verificação por mutação (e o que ela mostrou)**: cancelamento sem `FOR UPDATE` -> o teste
determinístico cancelou um lote que já tinha lance (200 em vez de 409); stream sem repasse dos
cabeçalhos CORS -> `access-control-allow-origin` some; cooldown zerado -> 3 chamadas em vez de 1.
Os três testes falham sem o código correspondente.
