# Leilão Online

Casa de leilões online com itens vindos da API pública do [Art Institute of Chicago](https://api.artic.edu/api/v1/artworks).
Teste técnico (Verzel — Elite Dev). Contexto completo do desafio em [`CLAUDE.md`](./CLAUDE.md);
decisões técnicas registradas em [`DECISIONS.md`](./DECISIONS.md); uso de IA documentado em
[`AI_USAGE.md`](./AI_USAGE.md).

> **Status**: Etapa 1 em andamento — esqueleto do monorepo, auth com papéis e health check.
> Vitrine, lances, carteira, worker de liquidação e auditoria pública chegam nas próximas etapas
> (ver seção "Roadmap" abaixo).

## Stack

- **Front**: React + Vite + TypeScript, React Router, TanStack Query.
- **Back**: Node + TypeScript, Fastify, Zod.
- **Banco**: PostgreSQL + Prisma ORM (SQL customizado para triggers/índices parciais/CHECKs que
  o Prisma não modela — ver `DECISIONS.md`).
- **Auth**: e-mail + senha (bcrypt), JWT via `Authorization: Bearer`.
- **Deploy**: backend + Postgres no Render, frontend no Vercel.

## Setup local

Pré-requisitos: Node ≥ 22, pnpm, Docker (para o Postgres local).

```bash
# 1. instalar dependências do monorepo
pnpm install

# 2. subir o Postgres local (porta 5433 — a 5432 pode já estar em uso no seu sistema)
pnpm db:up

# 3. configurar variáveis de ambiente
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# gerar segredos reais para JWT_SECRET e AUDIT_SECRET em apps/api/.env:
openssl rand -hex 32

# 4. aplicar as migrations
pnpm --filter @leilao/api prisma:migrate:deploy
# (em desenvolvimento, para criar novas migrations: pnpm --filter @leilao/api prisma:migrate:dev)

# 5. rodar API e web em terminais separados
pnpm dev:api   # http://localhost:3000
pnpm dev:web   # http://localhost:5173
```

Health check: `curl http://localhost:3000/health`.

## Variáveis de ambiente

### `apps/api/.env`

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string do Postgres |
| `PORT` | Porta do servidor Fastify (padrão 3000) |
| `NODE_ENV` | `development` \| `test` \| `production` |
| `CORS_ORIGIN` | Origem do frontend permitida no CORS |
| `JWT_SECRET` | Segredo para assinar os tokens de sessão |
| `AUDIT_SECRET` | Segredo da cadeia de hash da auditoria — **nunca** fica no banco |
| `WORKER_INTERVAL_MS` | Intervalo do worker que encerra e liquida lotes vencidos (padrão 1500) |

### `apps/web/.env`

| Variável | Descrição |
|---|---|
| `VITE_API_URL` | URL base da API |

## Deploy

Ordem importa por causa de uma dependência circular (a API precisa conhecer a URL do front para o
CORS, e o front precisa conhecer a URL da API): **API → front → CORS → seed**.

### 1. Backend + Postgres (Render)

O [`render.yaml`](./render.yaml) (Blueprint) descreve o serviço web e o banco. Os passos abaixo são
feitos no dashboard, já que exigem login na conta Render:

1. "New" → "Blueprint", conectar este repositório GitHub.
2. O Render cria `leilao-api` + `leilao-db`. `JWT_SECRET` e `AUDIT_SECRET` são gerados pelo Render e
   `DATABASE_URL` vem do banco criado. Deixe `CORS_ORIGIN` em branco por enquanto.
3. Ao subir, o start roda `prisma migrate deploy` e depois o servidor, que também inicia o worker
   de encerramento (fecha na hora os lotes que venceram enquanto o serviço dormia).

Observação: o `buildCommand` usa `pnpm install --prod=false` de propósito. Com `NODE_ENV=production`
o pnpm pularia as devDependencies, e `tsc` e `prisma` são necessárias no build e no start.

### 2. Frontend (Vercel)

1. "Add New" → "Project", conectar este repositório GitHub.
2. "Root Directory" = `apps/web` (o preset Vite é detectado).
3. Variável de ambiente `VITE_API_URL` = URL pública do `leilao-api` no Render.

### 3. CORS

No Render, em `leilao-api` → Environment, defina `CORS_ORIGIN` com a URL de produção do Vercel
(origem exata, sem barra final). Só **uma** origem é aceita, então URLs de preview do Vercel não
funcionam contra a API.

### 4. Seed de demonstração

O plano gratuito do Render não tem shell, então o seed roda **da sua máquina** contra o banco de
produção, usando a *External Database URL* do `leilao-db`.

> ⚠️ **Use o mesmo `AUDIT_SECRET` do Render.** A cadeia de hash é assinada com ele. Semear com um
> segredo diferente faz toda a auditoria pública acusar "adulterado". Copie o valor em
> `leilao-api` → Environment. Também nunca troque o `AUDIT_SECRET` depois do seed.

```bash
cd apps/api
DATABASE_URL="<external database url>" \
JWT_SECRET="qualquer-valor-com-16+-caracteres" \
AUDIT_SECRET="<mesmo valor do Render>" \
CORS_ORIGIN="https://<seu-app>.vercel.app" \
NODE_ENV=production ALLOW_SEED_RESET=1 \
pnpm prisma:seed
```

O seed **apaga todos os dados** do banco alvo (`TRUNCATE`); em `NODE_ENV=production` ele só roda
com `ALLOW_SEED_RESET=1`. Os lotes "ao vivo" do seed têm horários relativos ao momento em que ele
rodou e vencem com o tempo: rode o seed de novo perto da avaliação.

### 5. Verificação

- `GET <api>/health` responde `{"status":"ok",...}`.
- O front mostra o status da API e o login com `licitante1@demo.com` / `demo12345` funciona.
- `GET <api>/audit/lots/<id de um lote seed>` devolve `"verdict":"intact"`.
- Plano gratuito: depois de ~15 min parado o Render hiberna e a primeira requisição leva 30–60 s.
  O worker roda no boot e a leitura de um lote vencido também o fecha, então nada fica pendente.
- O Postgres gratuito do Render pode expirar após um período; confira o prazo no dashboard. A
  alternativa é um Postgres gratuito sem expiração (ex.: Neon), trocando só `DATABASE_URL`.

## Roadmap (etapas)

1. ✅ Esqueleto api+web, Postgres local, migrations, auth + papéis, health check, deploy "hello world".
2. Núcleo de lances + carteira + anti-sniping, com testes de concorrência.
3. Worker de encerramento + liquidação idempotente + comprovante + hash chain + auditoria pública + seed.
4. Telas: vitrine, sala ao vivo (SSE), painel do leiloeiro, carteira, meus arremates, mensagens de erro.
5. Docker Compose completo, README final, revisão, deploy final.

As seções de arquitetura, modelo de ameaça da auditoria, credenciais de teste e link do deploy
são preenchidas progressivamente conforme cada etapa é concluída.
