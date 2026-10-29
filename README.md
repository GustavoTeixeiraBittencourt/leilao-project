# ACERVO - Leilão Online

Casa de leilões online com obras do acervo aberto (CC0) do [Cleveland Museum of Art](https://openaccess-api.clevelandart.org/api/artworks/).
Teste técnico (Verzel — Elite Dev).

| | |
|---|---|
| **Front (deploy)** | https://leilao-project-seven.vercel.app |
| **API (deploy)** | https://leilao-api-4ogr.onrender.com (`/health`) |
| **Documentação da API (Swagger)** | https://leilao-api-4ogr.onrender.com/docs |
| Decisões técnicas | [`DECISIONS.md`](./DECISIONS.md) |
| Uso de IA | [`AI_USAGE.md`](./AI_USAGE.md) |
| Contexto do desafio | [`CLAUDE.md`](./CLAUDE.md) |

> O plano gratuito do Render hiberna após ~15 min parado: a primeira requisição leva 30–60 s. Ao acordar,
> o worker já fecha os lotes que venceram enquanto o serviço dormia.

## Contas de teste (seed)

Senha de todas: **`demo12345`**

| Conta | Papel | Saldo |
|---|---|---|
| `licitante1@demo.com` | Licitante | US$ 50.000,00 |
| `licitante2@demo.com` | Licitante | US$ 30.000,00 |
| `leiloeiro@demo.com` | Leiloeiro | — |

O seed cria lotes ao vivo (com e sem lances), agendados e encerrados já liquidados (um arrematado,
com comprovante, e um sem lances). Para ver um lote cancelado, crie e cancele um pelo painel do
leiloeiro. Os horários dos lotes ao vivo são relativos a quando o seed rodou e **vencem com o tempo**:
se a vitrine ficar vazia, rode o seed de novo (ver abaixo).

## O que o sistema faz

Dois papéis, cada conta tem um só:

- **Leiloeiro** cria e gerencia os próprios lotes. **Não pode dar lances** (bloqueado no servidor).
- **Licitante** deposita saldo simulado, dá lances e arremata.

| Tela | Rota | Quem |
|---|---|---|
| Vitrine (ao vivo, agendados, encerrados; busca e ordenação) | `/` | todos |
| Sala do lote ao vivo (SSE, contagem regressiva, histórico, "você está ganhando / foi superado") | `/lots/:id` | todos (dar lance: licitante) |
| Carteira (total, comprometido, disponível, depósito simulado, extrato) | `/wallet` | logado |
| Meus arremates (lotes em que dei lance e os vencidos, com comprovante e link compartilhável) | `/wins` | licitante |
| Comprovante público | `/r/:token` | todos |
| Auditoria pública (histórico completo e veredito íntegro/adulterado) | `/audit`, `/audit/:lotId` | todos, sem login |
| Painel do leiloeiro: meus lotes, resultado dos encerrados, editar ou cancelar lote sem lances | `/auctioneer` | leiloeiro |
| Editar lote (lance inicial, incremento, horários; a obra é o snapshot e não muda) | `/auctioneer/lots/:id/edit` | leiloeiro, dono do lote |
| Novo lote: busca no acervo do museu e publicação | `/auctioneer/new` | leiloeiro |
| Login / cadastro (escolha de papel) | `/login`, `/signup` | todos |
| Perfil: editar nome de exibição, trocar senha, resumo da conta por papel | `/profile` | logado |

Recusas de lance com mensagem clara (códigos estáveis da API): `BID_BELOW_MIN`, `INSUFFICIENT_FUNDS`,
`ALREADY_LEADING`, `LOT_NOT_STARTED`, `LOT_CLOSED`, `AUCTIONEER_CANNOT_BID`.

## Como rodar

Pré-requisitos: Docker. Para o modo de desenvolvimento, também Node ≥ 22 e pnpm.

### Opção A — tudo no Docker (mais simples)

```bash
docker compose up --build -d
docker compose exec -e ALLOW_SEED_RESET=1 api pnpm --filter @leilao/api prisma:seed
```

- Front: http://localhost:5173
- API: http://localhost:3000/health

O compose sobe `db` (Postgres 16), `api` (servidor + worker de encerramento) e `web` (build estático no
nginx). A API roda `prisma migrate deploy` ao iniciar. Os segredos do compose são **valores de
demonstração**; em qualquer ambiente real defina `JWT_SECRET` e `AUDIT_SECRET` próprios (ver abaixo).
Portas e URLs são ajustáveis por variável (`WEB_PORT`, `API_PORT`, `DB_PORT`, `CORS_ORIGIN`,
`VITE_API_URL`). A `VITE_API_URL` é gravada no bundle em tempo de *build* e chamada pelo navegador, então
precisa ser um endereço alcançável de fora do Docker.

### Opção B — desenvolvimento (API e front fora do Docker)

```bash
pnpm install
pnpm db:up                                   # só o Postgres, porta 5433 (a 5432 costuma estar ocupada)
cp apps/api/.env.example apps/api/.env       # preencha JWT_SECRET e AUDIT_SECRET (16+ caracteres)
cp apps/web/.env.example apps/web/.env
pnpm --filter @leilao/api prisma:migrate:deploy
pnpm --filter @leilao/api prisma:seed        # reseta o banco e cria os dados de demonstração

pnpm dev:api    # http://localhost:3000
pnpm dev:web    # http://localhost:5173
```

### Testes e verificação

```bash
pnpm --filter @leilao/api test   # 162 testes de integração (exigem o Postgres no ar)
pnpm --filter @leilao/web test   # 175 testes de lógica pura (dinheiro, relógio, SSE, auditoria, formulários, perfil, navegação)
pnpm lint                        # tsc em api e web
```

Os testes da API **não limpam o que criam** (o ledger e os lances são append-only por desenho); o seed
limpa tudo. Os testes de adulteração usam `SET LOCAL session_replication_role = replica`, que exige
superusuário (funciona no Postgres do compose; num banco gerenciado sem esse privilégio precisariam de
outra estratégia).

## Arquitetura

Monorepo simples:

```
apps/api   Fastify + Zod + Prisma (PostgreSQL). Servidor HTTP, SSE e worker de encerramento.
apps/web   React + Vite + TypeScript, React Router, TanStack Query. SPA.
```

**Stack**: Node + TypeScript, Fastify, Zod (toda entrada validada; erros `{ code, message }`),
PostgreSQL + Prisma, JWT (`Authorization: Bearer`; o papel vai no token **e é revalidado no banco**),
bcrypt, Vitest. SQL cru (`FOR UPDATE`, `SKIP LOCKED`, busca) fica concentrado em `apps/api/src/db/locks.ts`,
com o retorno tipado por Zod. O que o Prisma não modela (triggers, CHECKs, índices parciais) vive em SQL
customizado na migration inicial; ver o aviso de *drift* em [`CLAUDE.md`](./CLAUDE.md) §4.1.

### Dinheiro e tempo

- **Dinheiro**: `BIGINT` em centavos. Nunca float. A conversão para `number` acontece só na borda da API
  (os valores desta simulação ficam muito abaixo de `Number.MAX_SAFE_INTEGER`). No front, o texto digitado
  é convertido para centavos inteiros por parsing de string, não por `parseFloat`.
- **Tempo**: sempre o relógio do servidor. O cliente só calcula a contagem regressiva a partir de um
  *offset* (`serverNow`, enviado em respostas HTTP e eventos SSE) e **nunca decide a fase** de um lote:
  quando o horário indica que ele abriu ou encerrou, o front apenas pergunta de novo ao servidor.
- "Agendado" e "ao vivo" são **derivados do horário**; só `open | closed | cancelled` existem no banco.

### O lance (a transação crítica)

Uma única `prisma.$transaction` com `timeout`/`maxWait` explícitos:

1. `SELECT … FOR UPDATE` do **lote**;
2. `SELECT … FOR UPDATE` da linha do **licitante** (sempre nessa ordem, para evitar deadlock; o worker de
   liquidação usa a mesma ordem);
3. valida tudo (papel, status/horário, líder, mínimo, saldo disponível);
4. insere o lance já encadeado no hash;
5. atualiza o lote (lance atual, líder, contagem e `ends_at` se for anti-sniping);
6. commit, e **só depois** publica o evento SSE.

`placed_at` é o `clock_timestamp()` do banco, lido depois dos locks. O saldo **comprometido é derivado**
(soma do lance atual dos lotes abertos em que o usuário lidera), então quando alguém é superado o valor
volta ao disponível imediatamente, sem lançamento extra. Há testes de concorrência (lances simultâneos em
vários lotes com saldo para apenas um) e uma verificação por mutação: sem o lock do licitante, o teste
passa a aceitar comprometimento acima do saldo.

**Anti-sniping**: lance aceito nos últimos 2 minutos faz `ends_at = max(ends_at, agora + 2 min)`.
**Empate** é resolvido pela ordem em que as transações pegam o lock do lote.

### Liquidação (worker)

Um loop (padrão 1,5 s; `WORKER_INTERVAL_MS`) seleciona lotes `open` com `ends_at <= now()` usando
`FOR UPDATE SKIP LOCKED` e, **numa transação por lote**, marca `closed`, grava o selo, lança débito do
vencedor e crédito do leiloeiro no ledger e emite o comprovante. Lote sem lances encerra sem vencedor.
É **idempotente em três camadas**: (1) só liquida se o lote ainda está `open` e vencido, sob o lock do
lote; (2) o ledger tem índice único `(lot_id, kind, user_id)` com `ON CONFLICT DO NOTHING`; (3)
`UNIQUE(lot_id)` no comprovante. Não depende de tráfego: roda ao subir o serviço e também de forma
preguiçosa ao ler **um** lote (nunca na listagem), o que cobre planos que dormem.

### Tempo real

SSE (`GET /lots/:id/events`) com pub/sub em memória: eventos `ready`, `bid_placed`, `lot_closed`,
`lot_cancelled` e `ping` (com `serverNow`, para recalibrar a contagem). O endpoint é público de propósito
(o `EventSource` do navegador não envia `Authorization` e os eventos só têm dados públicos). O front
escreve os eventos direto no cache do React Query; **eventos perdidos numa queda não são reenviados**, então
a cada (re)conexão a sala relê o lote e o histórico.

> **Limitação conhecida**: o pub/sub é em memória, logo funciona em **instância única**. Com várias
> instâncias da API, um lance numa não chegaria aos assinantes SSE da outra (precisaria de Redis ou
> `LISTEN/NOTIFY`).

### API externa instável

A API do museu **nunca derruba nada**. Ao criar um lote, os dados da obra (título, artista, imagem,
atributos) são salvos como **snapshot** no banco; vitrine, sala, auditoria e comprovante só leem do banco.
A API externa é usada apenas na busca do painel do leiloeiro, com timeout de 3 s, cache de 10 min,
*cooldown* de 30 s depois de uma falha e **fallback local** (10 obras reais) com aviso de degradação na tela.

> **Achado importante**: a API do museu fica atrás de um *Cloudflare Managed Challenge* e responde **403**
> a clientes que não são navegador, **inclusive daqui** (ver `CLAUDE.md` §6). Em produção, a busca do
> servidor deve cair no fallback local, e o painel mostra a degradação. O caminho "API respondendo" foi
> testado só contra respostas simuladas no formato documentado, nunca ao vivo. As **imagens** são
> carregadas direto pelo *navegador* do usuário (`<img>` para o CDN do museu) e **nunca** passam pelo
> nosso backend; se o navegador não conseguir, a tela mostra "Imagem indisponível" e segue funcionando.

### Conta e perfil

`POST /auth/signup`, `POST /auth/login`, `GET /auth/me`, mais, no Perfil (`/profile`):

- `PATCH /auth/me`: edita só o **nome de exibição** (2 a 80 caracteres). E-mail, papel e **alias público** são
  imutáveis (o alias faz parte do histórico verificável). O nome não entra no hash da auditoria.
- `POST /auth/password`: troca a senha e **exige a senha atual** (erro `INVALID_CURRENT_PASSWORD`, HTTP 422). A
  senha nova tem de 8 a 72 caracteres (o bcrypt só considera 72 bytes) e precisa ser diferente da atual.

> **Limitação conhecida**: o JWT é stateless, então trocar a senha **não derruba sessões já abertas**; elas
> continuam válidas até o token expirar. A tela avisa isso. Revogar sessões exigiria guardar versão de token
> ou lista de revogação no banco.

## Histórico à prova de adulteração

**Técnica**: cadeia de hash com **HMAC-SHA256**. Cada lance guarda `prev_hash` e `hash`:

```
hash = HMAC_SHA256(AUDIT_SECRET,  prev_hash | lot_id | seq | alias | amount | placed_at)
```

O primeiro elo (*genesis*) amarra a cadeia aos parâmetros imutáveis do lote (id, leiloeiro, lance
inicial, incremento, início; `ends_at` fica de fora porque o anti-sniping o altera). Alterar, remover ou
inserir qualquer lance muda todos os hashes seguintes. O `AUDIT_SECRET` fica **fora do banco** (variável de
ambiente), então quem tem acesso só ao banco não consegue recalcular uma cadeia forjada que pareça válida.

**Auditoria** (`GET /audit/lots/:id`, pública): lê lote, comprovante e cadeia no **mesmo snapshot**
(`REPEATABLE READ`, senão um lance no meio viraria falso "adulterado"), recalcula a cadeia inteira do zero,
confere `seq` contíguo e o que está gravado fora dela (contagem, lance atual e líder do lote; no lote
encerrado, o **selo** e o **comprovante**) e devolve o veredito com o **primeiro ponto de quebra** e o
motivo. O selo (contagem + hash final) é gravado no encerramento do lote.

**Defesa em profundidade**: triggers bloqueiam `UPDATE`/`DELETE` em `bids` e `wallet_entries`. Isso é uma
camada extra, **não** a garantia principal (quem é dono do banco pode desativá-los); a garantia é a cadeia.

**Limites conhecidos** (registrados com honestidade):

- Num lote **ainda aberto**, remover o último lance **e** reescrever contagem, lance atual e líder do lote
  não é detectável sem uma âncora externa. Num lote **encerrado**, o selo e o comprovante tornam isso
  detectável. A tela de auditoria diz isso para lotes abertos; há um teste que documenta o limite.
- O hash inclui o `public_alias`; editar o alias de um usuário no banco também aparece como adulteração.
- A auditoria prova que o histórico **não foi alterado depois**; não prova que o lance foi legítimo na origem.

**Privacidade**: auditoria, histórico e comprovante identificam licitantes só por **alias pseudônimo
estável** ("Licitante #a3f9"), nunca nome ou e-mail. O alias tem 4 hex (65.536 valores) e é único; uma
colisão no cadastro é tratada com nova tentativa.

## Documentação da API (Swagger)

Documentação interativa em **`/docs`** da API (produção: https://leilao-api-4ogr.onrender.com/docs; local:
http://localhost:3000/docs). O documento OpenAPI cru está em `/docs/json`. Lá estão todas as rotas, os papéis
exigidos, os códigos de erro estáveis (`{ code, message }`) e como autenticar: faça `POST /auth/login`, copie o
`token` e use **Authorize** com ele.

- O documento é escrito à mão em [`apps/api/src/docs/openapi.ts`](./apps/api/src/docs/openapi.ts), porque as rotas
  validam com Zod e não com JSON Schema do Fastify. **Os corpos de requisição são gerados dos mesmos schemas Zod**
  que a API usa para validar (`zod-to-json-schema`), então não divergem; as respostas são descritas à mão, de forma
  resumida. Um teste (`apps/api/test/docs.test.ts`) garante que as rotas principais estão documentadas.
- O tempo real é **SSE** (`GET /lots/{id}/events`, `text/event-stream`). O Swagger UI não exibe streams; para ver os
  eventos use `curl -N <api>/lots/<id>/events`.

## Variáveis de ambiente

### `apps/api/.env`

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string do Postgres |
| `PORT` | Porta do Fastify (padrão 3000) |
| `NODE_ENV` | `development` \| `test` \| `production` |
| `CORS_ORIGIN` | **Uma** origem do front permitida no CORS (não pode ficar vazia) |
| `JWT_SECRET` | Segredo dos tokens de sessão (16+ caracteres) |
| `AUDIT_SECRET` | Segredo da cadeia de hash (16+ caracteres). **Nunca** fica no banco e **nunca deve ser trocado depois do seed** |
| `WORKER_INTERVAL_MS` | Intervalo do worker de encerramento (padrão 1500) |

### `apps/web/.env`

| Variável | Descrição |
|---|---|
| `VITE_API_URL` | URL base da API (gravada no bundle em tempo de build) |

Gerar segredos: `openssl rand -hex 32`. Nunca commite segredos: `.env` está no `.gitignore`.

## Deploy

Backend + Postgres no **Render**, front no **Vercel**. Ordem importa por causa de uma dependência circular
(a API precisa da URL do front para o CORS, e o front precisa da URL da API): **API → front → CORS → seed**.

### 1. Backend + Postgres (Render)

O [`render.yaml`](./render.yaml) (Blueprint) descreve o serviço web e o banco. No dashboard:

1. "New" → "Blueprint", conectar este repositório.
2. O Render cria `leilao-api` + `leilao-db`. `JWT_SECRET` e `AUDIT_SECRET` são gerados e `DATABASE_URL` vem
   do banco. **`CORS_ORIGIN` não pode ficar vazio**: a API valida o ambiente no boot e aborta com
   `Invalid environment variables`. Use um valor provisório (`https://placeholder.invalid`) e troque no
   passo 3.
3. O start roda `prisma migrate deploy` (nunca `migrate dev`) e sobe o servidor, que também inicia o worker.

O `buildCommand` usa `pnpm install --prod=false` de propósito: com `NODE_ENV=production` o pnpm pularia as
devDependencies, e `tsc` e `prisma` são necessárias no build e no start.

### 2. Frontend (Vercel)

"Add New" → "Project", conectar o repositório, **Root Directory = `apps/web`**, variável `VITE_API_URL` =
URL pública da API no Render. O `vercel.json` já reescreve todas as rotas para `index.html` (links
compartilháveis como `/r/<token>` funcionam ao abrir direto).

### 3. CORS

No Render, em `leilao-api` → Environment, defina `CORS_ORIGIN` com a URL de produção do Vercel (origem
exata, sem barra final). Só **uma** origem é aceita, então URLs de *preview* do Vercel não funcionam contra
a API.

### 4. Seed de demonstração

O plano gratuito do Render não tem shell: o seed roda **da sua máquina** contra o banco de produção, com a
*External Database URL* do `leilao-db`.

> ⚠️ **Use o mesmo `AUDIT_SECRET` do Render.** A cadeia é assinada com ele; semear com outro segredo faz toda
> a auditoria pública acusar "adulterado". Nunca grave credenciais em arquivos: passe só pelo comando.

```bash
cd apps/api
DATABASE_URL="<external database url>" \
JWT_SECRET="qualquer-valor-com-16+-caracteres" \
AUDIT_SECRET="<mesmo valor do Render>" \
CORS_ORIGIN="https://<seu-app>.vercel.app" \
NODE_ENV=production ALLOW_SEED_RESET=1 \
pnpm prisma:seed
```

O seed **apaga todos os dados** (`TRUNCATE`); em `NODE_ENV=production` só roda com `ALLOW_SEED_RESET=1`. Ele
passa pelo código real (`placeBid` → `settleLot`), então a auditoria dos lotes encerrados dá "íntegro", e
audita tudo no final (falha se algo não fechar). **Rode de novo perto da avaliação**, porque os lotes ao
vivo vencem com o tempo.

### 5. Verificação

- `GET <api>/health` → `{"status":"ok",...}`.
- Login com `licitante1@demo.com` / `demo12345` e a Vitrine com lotes.
- `GET <api>/audit/lots/<id de um lote do seed>` → `"verdict":"intact"`.
- O Postgres gratuito do Render pode expirar após um período; confira o prazo no dashboard. A alternativa é
  um Postgres sem expiração (ex.: Neon), trocando só `DATABASE_URL`.

## Fora de escopo

Nota fiscal, revenda, app nativo e recuperação de senha (conforme o enunciado).

## Limitações conhecidas (resumo)

- SSE em **instância única** (sem fan-out entre instâncias). O tempo real é SSE (HTTP), não WebSocket: o fluxo é só
  servidor → navegador, e o `EventSource` reconecta sozinho.
- Não implementados, por decisão de escopo (ver `DECISIONS.md`): **dark mode**, **PWA** (instalável/offline) e
  **internacionalização** (a interface é só em português do Brasil; as mensagens de erro da API, em inglês).
- Hash chain: limite em lote aberto descrito acima.
- Cancelamento só sem lances, portanto **sem estorno** (não há valor comprometido a devolver).
- Busca no acervo do museu: provavelmente cai no fallback local em produção (Cloudflare).
- Os testes de componente/E2E de navegador **não existem**: o front tem testes de lógica pura; a conferência
  visual e de usabilidade é manual.
- Sem paginação na vitrine (limite de 50 por fase).

## Uso de IA

Este projeto foi desenvolvido com apoio do Claude Code. O que foi gerado, o que precisa de revisão humana e
os limites do que foi verificado estão em [`AI_USAGE.md`](./AI_USAGE.md); as decisões e trade-offs, em
[`DECISIONS.md`](./DECISIONS.md).
