# API + worker de encerramento (mesmo processo). Contexto de build: raiz do repositório.
#   docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim

# O Prisma precisa do OpenSSL no runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@12

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api ./apps/api

# `--filter @leilao/api...` instala só a API (o front não entra na imagem). O postinstall
# roda `prisma generate`, por isso o schema é copiado ANTES do install. As devDependencies
# ficam: `prisma migrate deploy` (no start) e o seed dependem delas.
RUN pnpm install --frozen-lockfile --filter @leilao/api...
RUN pnpm --filter @leilao/api build

ENV NODE_ENV=production
EXPOSE 3000

# Aplica as migrations (migrate deploy, nunca migrate dev) e sobe o servidor + worker.
CMD ["pnpm", "--filter", "@leilao/api", "start"]
