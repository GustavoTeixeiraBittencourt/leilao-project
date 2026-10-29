import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import { loginSchema, signupSchema, updateProfileSchema, changePasswordSchema } from "../modules/auth/schemas.js";
import { placeBidSchema } from "../modules/bids/schemas.js";
import { createLotSchema, updateLotSchema } from "../modules/lots/schemas.js";
import { depositSchema } from "../modules/wallet/schemas.js";

// Documentação OpenAPI escrita à mão (as rotas validam com Zod, não com JSON Schema do Fastify,
// então o plugin não consegue inferir nada sozinho). Os CORPOS DE REQUISIÇÃO vêm dos mesmos
// schemas Zod que a API usa para validar: se a regra mudar, a doc muda junto.
// As respostas são descritas à mão e resumidas; o código é a fonte de verdade.

const fromZod = (schema: ZodTypeAny) => zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" });

const jsonBody = (schema: ZodTypeAny) => ({
  required: true,
  content: { "application/json": { schema: fromZod(schema) } },
});

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });
const ok = (description: string, schema: object, status = "200") => ({ [status]: { description, content: json(schema) } });
const errors = (...codes: string[]) =>
  Object.fromEntries(
    codes.map((code) => [
      code,
      { description: ERROR_DESCRIPTIONS[code] ?? "Erro", content: json(ref("Error")) },
    ]),
  );

const ERROR_DESCRIPTIONS: Record<string, string> = {
  "400": "VALIDATION_ERROR: corpo ou parâmetros inválidos",
  "401": "UNAUTHORIZED / INVALID_CREDENTIALS: sem token válido",
  "403": "FORBIDDEN / AUCTIONEER_CANNOT_BID: papel sem permissão",
  "404": "NOT_FOUND",
  "409": "Conflito de regra (EMAIL_ALREADY_IN_USE, LOT_HAS_BIDS, LOT_NOT_CANCELLABLE, LOT_NOT_EDITABLE)",
  "422": "Recusa de regra de negócio (BID_BELOW_MIN, INSUFFICIENT_FUNDS, ALREADY_LEADING, LOT_NOT_STARTED, LOT_CLOSED, INVALID_CURRENT_PASSWORD)",
};

const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
  description: "Id do lote",
};
const auth = [{ bearerAuth: [] }];

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "ACERVO · API do Leilão Online",
    version: "1.0.0",
    description: [
      "API do leilão de obras do acervo aberto do Cleveland Museum of Art (simulado: saldos e valores não são reais).",
      "",
      "**Convenções**",
      "- Dinheiro sempre em **centavos inteiros** (`...Cents`). Nunca decimal.",
      "- Tempo sempre do **relógio do servidor**; respostas trazem `serverNow` para o cliente calcular a contagem.",
      "- Erros no formato `{ code, message }`. Os códigos são estáveis; o texto de `message` está em inglês.",
      "- Autenticação: `Authorization: Bearer <token>` (token devolvido por `/auth/signup` e `/auth/login`).",
      "- Participantes aparecem só por **alias pseudônimo** (ex.: `Licitante #a3f9`), nunca nome ou e-mail.",
      "- Tempo real por **SSE** em `GET /lots/{id}/events` (veja a rota; o Swagger UI não consegue exibir streams).",
      "",
      "**Papéis**: `bidder` (licitante: deposita e dá lances) e `auctioneer` (leiloeiro: cria e gerencia lotes, não dá lances).",
    ].join("\n"),
  },
  tags: [
    { name: "Sistema" },
    { name: "Conta" },
    { name: "Carteira" },
    { name: "Lotes" },
    { name: "Lances" },
    { name: "Tempo real" },
    { name: "Auditoria e comprovantes" },
    { name: "Minhas áreas" },
    { name: "Acervo externo" },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: {
            type: "string",
            example: "BID_BELOW_MIN",
            enum: [
              "VALIDATION_ERROR",
              "EMAIL_ALREADY_IN_USE",
              "INVALID_CREDENTIALS",
              "INVALID_CURRENT_PASSWORD",
              "UNAUTHORIZED",
              "FORBIDDEN",
              "NOT_FOUND",
              "BID_BELOW_MIN",
              "INSUFFICIENT_FUNDS",
              "ALREADY_LEADING",
              "LOT_NOT_STARTED",
              "LOT_CLOSED",
              "LOT_HAS_BIDS",
              "LOT_NOT_CANCELLABLE",
              "LOT_NOT_EDITABLE",
              "AUCTIONEER_CANNOT_BID",
              "INTERNAL_ERROR",
            ],
          },
          message: { type: "string" },
        },
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          displayName: { type: "string" },
          role: { type: "string", enum: ["bidder", "auctioneer"] },
          publicAlias: { type: "string", example: "Licitante #a3f9" },
        },
      },
      Session: {
        type: "object",
        properties: { token: { type: "string" }, user: ref("User") },
      },
      Lot: {
        type: "object",
        description: "Lote com o snapshot da obra (não depende da API do museu).",
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          imageUrl: { type: "string", nullable: true },
          attributes: { type: "object", additionalProperties: true, description: "artist_display, date_display, medium_display, dimensions, credit_line, ..." },
          startingBidCents: { type: "integer" },
          minIncrementCents: { type: "integer" },
          startsAt: { type: "string", format: "date-time" },
          endsAt: { type: "string", format: "date-time", description: "Pode avançar (anti-sniping: lance nos últimos 2 min leva para agora + 2 min)." },
          status: { type: "string", enum: ["open", "closed", "cancelled"] },
          phase: { type: "string", enum: ["scheduled", "live", "ended", "cancelled"], description: "Derivada do horário do servidor." },
          currentBidCents: { type: "integer", nullable: true },
          bidCount: { type: "integer" },
          leaderAlias: { type: "string", nullable: true },
          winnerAlias: { type: "string", nullable: true },
          finalPriceCents: { type: "integer", nullable: true },
          serverNow: { type: "string", format: "date-time" },
        },
      },
      Balance: {
        type: "object",
        properties: {
          totalCents: { type: "integer" },
          committedCents: { type: "integer", description: "Soma dos lances em que a pessoa lidera, em lotes abertos." },
          availableCents: { type: "integer", description: "total - comprometido" },
          serverNow: { type: "string", format: "date-time" },
        },
      },
      PublicBid: {
        type: "object",
        properties: {
          seq: { type: "integer" },
          bidderAlias: { type: "string" },
          amountCents: { type: "integer" },
          placedAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Sistema"],
        summary: "Verifica se a API está no ar",
        responses: ok("Servidor vivo", {
          type: "object",
          properties: { status: { type: "string", example: "ok" }, serverNow: { type: "string", format: "date-time" } },
        }),
      },
    },

    "/auth/signup": {
      post: {
        tags: ["Conta"],
        summary: "Cria uma conta (o papel é escolhido aqui e não muda depois)",
        requestBody: jsonBody(signupSchema),
        responses: { ...ok("Conta criada, já com token", ref("Session"), "201"), ...errors("400", "409") },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Conta"],
        summary: "Entra com e-mail e senha",
        requestBody: jsonBody(loginSchema),
        responses: { ...ok("Sessão", ref("Session")), ...errors("400", "401") },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Conta"],
        summary: "Dados da conta autenticada",
        security: auth,
        responses: { ...ok("Usuário", { type: "object", properties: { user: ref("User") } }), ...errors("401", "404") },
      },
      patch: {
        tags: ["Conta"],
        summary: "Altera o nome de exibição (o alias público não muda)",
        security: auth,
        requestBody: jsonBody(updateProfileSchema),
        responses: { ...ok("Usuário atualizado", { type: "object", properties: { user: ref("User") } }), ...errors("400", "401") },
      },
    },
    "/auth/password": {
      post: {
        tags: ["Conta"],
        summary: "Troca a senha (exige a senha atual)",
        security: auth,
        requestBody: jsonBody(changePasswordSchema),
        responses: { "204": { description: "Senha alterada" }, ...errors("400", "401", "422") },
      },
    },

    "/wallet": {
      get: {
        tags: ["Carteira"],
        summary: "Saldo (total, comprometido, disponível), extrato e lances da pessoa",
        security: auth,
        responses: {
          ...ok("Carteira", {
            allOf: [
              ref("Balance"),
              {
                type: "object",
                properties: {
                  entries: {
                    type: "array",
                    description: "Livro-razão append-only: deposit, settlement_debit, settlement_credit, refund.",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        kind: { type: "string", enum: ["deposit", "settlement_debit", "settlement_credit", "refund"] },
                        amountCents: { type: "integer", description: "Assinado." },
                        lotId: { type: "string", nullable: true },
                        createdAt: { type: "string", format: "date-time" },
                      },
                    },
                  },
                  bids: { type: "array", items: { type: "object", additionalProperties: true } },
                },
              },
            ],
          }),
          ...errors("401"),
        },
      },
    },
    "/wallet/deposit": {
      post: {
        tags: ["Carteira"],
        summary: "Depósito simulado (só licitante)",
        security: auth,
        requestBody: jsonBody(depositSchema),
        responses: { ...ok("Novo saldo", ref("Balance"), "201"), ...errors("400", "401", "403") },
      },
    },

    "/lots": {
      get: {
        tags: ["Lotes"],
        summary: "Lista pública de lotes (cancelados nunca aparecem)",
        description: "Sem `phase` devolve só as contagens por fase (`counts`); com `phase`, os lotes daquela fase.",
        parameters: [
          { name: "phase", in: "query", schema: { type: "string", enum: ["live", "scheduled", "ended"] } },
          { name: "q", in: "query", schema: { type: "string", maxLength: 100 }, description: "Busca por título ou artista" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: {
          ...ok("Lotes e contagem por fase", {
            type: "object",
            properties: {
              lots: { type: "array", items: ref("Lot") },
              counts: { type: "object", properties: { live: { type: "integer" }, scheduled: { type: "integer" }, ended: { type: "integer" } } },
              serverNow: { type: "string", format: "date-time" },
            },
          }),
          ...errors("400"),
        },
      },
      post: {
        tags: ["Lotes"],
        summary: "Cria um lote com o snapshot da obra (só leiloeiro)",
        security: auth,
        requestBody: jsonBody(createLotSchema),
        responses: { ...ok("Lote criado", { type: "object", properties: { lot: ref("Lot") } }, "201"), ...errors("400", "401", "403") },
      },
    },
    "/lots/{id}": {
      get: {
        tags: ["Lotes"],
        summary: "Um lote (fecha preguiçosamente se já venceu)",
        parameters: [idParam],
        responses: { ...ok("Lote", { type: "object", properties: { lot: ref("Lot") } }), ...errors("400", "404") },
      },
      patch: {
        tags: ["Lotes"],
        summary: "Edita lance inicial, incremento e horários (só o dono, só sem lances)",
        security: auth,
        parameters: [idParam],
        requestBody: jsonBody(updateLotSchema),
        responses: { ...ok("Lote atualizado", { type: "object", properties: { lot: ref("Lot") } }), ...errors("400", "401", "403", "404", "409") },
      },
    },
    "/lots/{id}/cancel": {
      post: {
        tags: ["Lotes"],
        summary: "Cancela um lote sem lances (só o dono)",
        security: auth,
        parameters: [idParam],
        responses: { ...ok("Lote cancelado", { type: "object", properties: { lot: ref("Lot") } }), ...errors("401", "403", "404", "409") },
      },
    },

    "/lots/{id}/bids": {
      get: {
        tags: ["Lances"],
        summary: "Histórico público de lances do lote",
        parameters: [idParam],
        responses: {
          ...ok("Lances em ordem", {
            type: "object",
            properties: { bids: { type: "array", items: ref("PublicBid") }, serverNow: { type: "string", format: "date-time" } },
          }),
          ...errors("404"),
        },
      },
      post: {
        tags: ["Lances"],
        summary: "Dá um lance",
        description:
          "Transação única: trava o lote e depois o licitante, valida tudo, grava o lance com hash encadeado e só então publica o evento SSE. " +
          "Regras: lote ao vivo; 1º lance ≥ lance inicial; seguintes ≥ atual + incremento; o líder não cobre o próprio lance; o valor cabe no disponível; leiloeiro não dá lance. " +
          "Lance nos últimos 2 minutos prorroga o fim para `agora + 2 min`.",
        security: auth,
        parameters: [idParam],
        requestBody: jsonBody(placeBidSchema),
        responses: {
          ...ok(
            "Lance aceito",
            {
              type: "object",
              properties: {
                bid: { type: "object", properties: { seq: { type: "integer" }, amountCents: { type: "integer" }, placedAt: { type: "string", format: "date-time" } } },
                lot: ref("Lot"),
                wallet: { type: "object", properties: { totalCents: { type: "integer" }, committedCents: { type: "integer" }, availableCents: { type: "integer" } } },
                extended: { type: "boolean", description: "true se o lance prorrogou o fim (anti-sniping)." },
              },
            },
            "201",
          ),
          ...errors("400", "401", "403", "404", "422"),
        },
      },
    },

    "/lots/{id}/events": {
      get: {
        tags: ["Tempo real"],
        summary: "Stream SSE do lote (text/event-stream)",
        description:
          "Público. Eventos: `ready`, `bid_placed`, `lot_closed`, `lot_cancelled` e `ping` (a cada 20 s, com `serverNow`). " +
          "Cada evento é `event: <tipo>` + `data: <json>`. O navegador reconecta sozinho (`retry: 3000`); eventos perdidos na queda não são reenviados, " +
          "então o cliente relê o lote e o histórico ao reconectar. Pub/sub em memória: instância única da API. " +
          "Teste com `curl -N` ou `new EventSource(url)`; o botão Execute do Swagger UI não exibe streams.",
        parameters: [idParam],
        responses: {
          "200": { description: "Stream aberto", content: { "text/event-stream": { schema: { type: "string" } } } },
          ...errors("404"),
        },
      },
    },

    "/audit/lots/{id}": {
      get: {
        tags: ["Auditoria e comprovantes"],
        summary: "Auditoria pública: histórico completo de lances e veredito",
        description:
          "Recalcula a cadeia de hash inteira (HMAC-SHA256 com segredo fora do banco), confere `seq` contíguo e, em lote encerrado, compara com o selo. " +
          "Devolve o veredito `íntegro`/`adulterado` e o primeiro ponto de quebra. Licitantes só por alias.",
        parameters: [idParam],
        responses: { ...ok("Resultado da auditoria", { type: "object", additionalProperties: true }), ...errors("404") },
      },
    },
    "/receipts/{token}": {
      get: {
        tags: ["Auditoria e comprovantes"],
        summary: "Comprovante público de arremate (o token aleatório é a credencial)",
        parameters: [{ name: "token", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,64}$" } }],
        responses: { ...ok("Comprovante", { type: "object", additionalProperties: true }), ...errors("400", "404") },
      },
    },

    "/me/wins": {
      get: {
        tags: ["Minhas áreas"],
        summary: "Lotes arrematados pelo licitante, com comprovante",
        security: auth,
        responses: { ...ok("Arremates", { type: "object", additionalProperties: true }), ...errors("401", "403") },
      },
    },
    "/me/bids": {
      get: {
        tags: ["Minhas áreas"],
        summary: "Lotes em que o licitante deu lances, com o estado de cada um",
        security: auth,
        responses: { ...ok("Lances por lote", { type: "object", additionalProperties: true }), ...errors("401", "403") },
      },
    },
    "/me/auctions": {
      get: {
        tags: ["Minhas áreas"],
        summary: "Lotes do leiloeiro com resultado e total recebido",
        security: auth,
        responses: { ...ok("Painel do leiloeiro", { type: "object", additionalProperties: true }), ...errors("401", "403") },
      },
    },

    "/external/artworks": {
      get: {
        tags: ["Acervo externo"],
        summary: "Busca obras no acervo do Cleveland Museum of Art (só leiloeiro)",
        description:
          "A API do museu é tratada como instável: timeout curto e, se falhar, responde `degraded: true` com o motivo e obras locais de reserva. " +
          "Nunca devolve 5xx por falha externa. Vitrine, salas, auditoria e comprovantes não dependem desta rota (o lote guarda um snapshot).",
        security: auth,
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string", minLength: 2, maxLength: 100 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 20, default: 8 } },
        ],
        responses: {
          ...ok("Resultados (ou fallback)", {
            type: "object",
            properties: {
              items: { type: "array", items: { type: "object", additionalProperties: true } },
              degraded: { type: "boolean" },
              message: { type: "string", nullable: true },
              serverNow: { type: "string", format: "date-time" },
            },
          }),
          ...errors("400", "401", "403"),
        },
      },
    },
  },
};
