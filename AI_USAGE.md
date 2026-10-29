# Uso de IA neste projeto

A IA foi utilizada neste projeto para atuar como Engenheiro de software sênior (staff) agindo no formato de par técnico do usuário. Trabalhar como em time real:
planejar antes de codar,testes E2E/integração onde há risco de regra de negócio, avisar sobre trade-offs relevantes.


## Etapa 1: lances, carteira e anti-sniping (2026-10-26)

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

## Etapa 2: liquidação, worker, auditoria, comprovante e seed (2026-10-26)

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

## Etapa 3, Parte B: telas do front + Docker Compose + README (2026-10-27)

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


---

## Revisão final: edição de lote, menu mobile, Swagger e correção do cancelamento (2026-10-29)

**O que a IA gerou**: `PATCH /lots/:id` e a tela de editar lote (`EditLot`, `ArtworkSheet` compartilhado com a sala,
`CancelLotAction`); ajustes do painel e do "Novo lote"; o menu lateral do mobile (`<dialog>` em `Layout.tsx`,
`lib/nav.ts`) no lugar da barra de abas; rolagem ao topo e título por rota; o tom `info` do `Notice`; a documentação
Swagger (`/docs`, `src/docs/openapi.ts`, corpos gerados dos schemas Zod); a atualização do README e do
`DECISIONS.md`; e a correção do botão "Confirmar cancelamento" com 2 testes novos. Total ao fim: 162 testes na API e
175 no front. O usuário definiu o escopo de cada pedido e decidiu **não** fazer dark mode, PWA e i18n.

**O que precisa de revisão humana** (explicar em entrevista):
- `modules/lots/service.ts` (`updateLot`): mesma regra e mesmo lock (`FOR UPDATE`) do cancelamento; só o dono, só sem
  lances, início fixo depois que o lote abre. Saber dizer por que título, imagem e atributos não são editáveis
  (são o snapshot que mantém o lote vivo sem a API do museu).
- **O bug do cancelamento**: o front mandava `Content-Type: application/json` num POST sem corpo; o Fastify recusa
  JSON vazio e o handler de erros devolvia 500. Os testes não pegavam porque não enviavam esse cabeçalho. A API agora
  aceita corpo vazio e o front só declara JSON quando há corpo. Lição: teste com os cabeçalhos reais do navegador.
- `docs/openapi.ts` é escrito **à mão**: uma rota nova precisa ser acrescentada ali (o `docs.test.ts` cobre as
  principais). Os corpos vêm de `zod-to-json-schema`; as respostas são resumidas e podem ficar defasadas.
- O menu lateral depende do `<dialog>` nativo (foco preso e Esc vêm do navegador). Não há teste de componente.

**Limites do que foi verificado**: lint, testes da API e do front, build de produção, e chamadas à API local e à de
produção por `curl`/injeção. **Nenhuma tela foi aberta em navegador pela IA**: o menu lateral, o layout da edição, o
painel e a rolagem precisam de conferência visual. O cancelamento foi reproduzido e corrigido pela API, não pelo clique.

**Erro meu desta rodada**: afirmei que o cancelamento funcionava depois de testá-lo só com `curl` sem o cabeçalho que o
navegador envia; o usuário viu o erro no navegador. Também quebrei o `EditLot.tsx` ao reformatá-lo por script e reescrevi
o trecho final; o `tsc` e os testes confirmaram o arquivo.
