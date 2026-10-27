# Front (SPA estática servida pelo nginx). Contexto de build: raiz do repositório.
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=http://localhost:3000 .
FROM node:22-bookworm-slim AS build

RUN npm install -g pnpm@12
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @leilao/web...

# A URL da API é gravada no bundle em tempo de BUILD (Vite substitui import.meta.env), e
# é chamada pelo NAVEGADOR de quem usa o site, então tem que ser um endereço alcançável
# de fora do Docker (não o nome do serviço "api").
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @leilao/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
