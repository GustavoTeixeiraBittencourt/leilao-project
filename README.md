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

### `apps/web/.env`

| Variável | Descrição |
|---|---|
| `VITE_API_URL` | URL base da API |

## Deploy

### Backend + Postgres (Render)

Este repositório inclui um [`render.yaml`](./render.yaml) (Render Blueprint) com o serviço web e
o banco já descritos. Passos (feitos pelo usuário no dashboard, já que exigem login na conta
Render):

1. No dashboard do Render, "New" → "Blueprint", conectar este repositório GitHub.
2. Render lê o `render.yaml` e cria o serviço `leilao-api` + o banco `leilao-db` automaticamente.
3. `JWT_SECRET`/`AUDIT_SECRET` são gerados automaticamente pelo Render; `DATABASE_URL` é
   preenchido a partir do banco criado. Só falta preencher `CORS_ORIGIN` com a URL do deploy no
   Vercel (passo seguinte) depois que ela existir.

### Frontend (Vercel)

1. No dashboard da Vercel, "Add New" → "Project", conectar este repositório GitHub.
2. Em "Root Directory", selecionar `apps/web` (framework preset: Vite é detectado automaticamente).
3. Variável de ambiente `VITE_API_URL` = URL pública do serviço `leilao-api` no Render.
4. Depois do primeiro deploy, voltar no Render e preencher `CORS_ORIGIN` com a URL gerada pela Vercel.

## Roadmap (etapas)

1. ✅ Esqueleto api+web, Postgres local, migrations, auth + papéis, health check, deploy "hello world".
2. Núcleo de lances + carteira + anti-sniping, com testes de concorrência.
3. Worker de encerramento + liquidação idempotente + comprovante + hash chain + auditoria pública + seed.
4. Telas: vitrine, sala ao vivo (SSE), painel do leiloeiro, carteira, meus arremates, mensagens de erro.
5. Docker Compose completo, README final, revisão, deploy final.

As seções de arquitetura, modelo de ameaça da auditoria, credenciais de teste e link do deploy
são preenchidas progressivamente conforme cada etapa é concluída.
