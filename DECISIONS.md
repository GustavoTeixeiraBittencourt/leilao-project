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
