-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('auctioneer', 'bidder');

-- CreateEnum
CREATE TYPE "WalletEntryKind" AS ENUM ('deposit', 'settlement_debit', 'settlement_credit', 'refund');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('open', 'closed', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "display_name" TEXT NOT NULL,
    "public_alias" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auctioneer_id" UUID NOT NULL,
    "external_source" TEXT NOT NULL DEFAULT 'artic',
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image_url" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "starting_bid_cents" BIGINT NOT NULL,
    "min_increment_cents" BIGINT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "LotStatus" NOT NULL DEFAULT 'open',
    "current_bid_cents" BIGINT,
    "leader_id" UUID,
    "bid_count" INTEGER NOT NULL DEFAULT 0,
    "winner_id" UUID,
    "final_price_cents" BIGINT,
    "closed_at" TIMESTAMPTZ(3),
    "seal_count" INTEGER,
    "seal_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lot_id" UUID NOT NULL,
    "bidder_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "placed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" INTEGER NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" "WalletEntryKind" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "lot_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lot_id" UUID NOT NULL,
    "winner_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "public_token" TEXT NOT NULL,
    "seal_count" INTEGER NOT NULL,
    "seal_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_public_alias_key" ON "users"("public_alias");

-- CreateIndex
CREATE INDEX "lots_status_idx" ON "lots"("status");

-- CreateIndex
CREATE INDEX "lots_starts_at_idx" ON "lots"("starts_at");

-- CreateIndex
CREATE INDEX "lots_auctioneer_id_idx" ON "lots"("auctioneer_id");

-- CreateIndex
CREATE INDEX "bids_lot_id_idx" ON "bids"("lot_id");

-- CreateIndex
CREATE INDEX "bids_bidder_id_idx" ON "bids"("bidder_id");

-- CreateIndex
CREATE UNIQUE INDEX "bids_lot_id_seq_key" ON "bids"("lot_id", "seq");

-- CreateIndex
CREATE INDEX "wallet_entries_user_id_idx" ON "wallet_entries"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_lot_id_key" ON "receipts"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_public_token_key" ON "receipts"("public_token");

-- CreateIndex
CREATE INDEX "receipts_public_token_idx" ON "receipts"("public_token");

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_auctioneer_id_fkey" FOREIGN KEY ("auctioneer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- SQL customizado — objetos que o schema.prisma não consegue expressar
-- (CHECK constraints, índices parciais, triggers). Prisma Migrate não
-- modela nenhum desses. Qualquer `prisma migrate dev` futuro precisa ser
-- revisado (--create-only + leitura manual) antes de aplicar, para
-- garantir que o diff não gere DROP para o que está aqui — ver
-- DECISIONS.md "Prisma: SQL customizado e risco de drift".
-- ============================================================

-- gen_random_uuid() já é nativo no Postgres 16 (usado nos @default dos
-- models), mas deixamos isso explícito e idempotente para portabilidade
-- entre provedores gerenciados com versões diferentes de Postgres.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Dinheiro nunca pode ser <= 0 (lance) ou negativo (lote); datas do lote
-- precisam fazer sentido. Defesa em profundidade: o app já valida isso,
-- mas a constraint garante mesmo se alguém escrever direto no banco.
ALTER TABLE "bids" ADD CONSTRAINT bids_amount_positive CHECK (amount_cents > 0);
ALTER TABLE "lots" ADD CONSTRAINT lots_current_bid_non_negative CHECK (current_bid_cents IS NULL OR current_bid_cents >= 0);
ALTER TABLE "lots" ADD CONSTRAINT lots_starting_bid_positive CHECK (starting_bid_cents > 0);
ALTER TABLE "lots" ADD CONSTRAINT lots_min_increment_positive CHECK (min_increment_cents > 0);
ALTER TABLE "lots" ADD CONSTRAINT lots_ends_after_starts CHECK (ends_at > starts_at);
ALTER TABLE "wallet_entries" ADD CONSTRAINT wallet_entries_lot_required_by_kind CHECK (
  (kind = 'deposit' AND lot_id IS NULL) OR
  (kind IN ('settlement_debit','settlement_credit','refund') AND lot_id IS NOT NULL)
);

-- Âncora de idempotência da liquidação: o worker faz
-- `INSERT ... ON CONFLICT (lot_id, kind, user_id) DO NOTHING`, então um
-- lote nunca é liquidado duas vezes mesmo se o worker reprocessar depois
-- de um crash.
CREATE UNIQUE INDEX wallet_entries_idempotency
  ON "wallet_entries" (lot_id, kind, user_id)
  WHERE kind IN ('settlement_debit', 'settlement_credit', 'refund');

-- Saldo comprometido é SUM(current_bid_cents) dos lotes abertos em que o
-- usuário é líder — esse índice parcial evita full scan em "lots" a cada
-- leitura de carteira.
CREATE INDEX lots_leader_open_idx ON "lots" (leader_id) WHERE status = 'open';

-- O worker de encerramento escaneia lotes abertos vencidos; índice parcial
-- porque lotes closed/cancelled nunca entram nessa busca de novo.
CREATE INDEX lots_ends_at_open_idx ON "lots" (ends_at) WHERE status = 'open';

-- bids e wallet_entries são a trilha à prova de adulteração: a cadeia de
-- hash só vale algo se nenhuma linha puder ser editada ou removida depois
-- de escrita, nem por quem tem acesso direto ao banco. Trigger é defesa
-- extra, não a garantia principal (ver README "modelo de ameaça").
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only, % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bids_no_update           BEFORE UPDATE ON "bids"           FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER bids_no_delete           BEFORE DELETE ON "bids"           FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER wallet_entries_no_update BEFORE UPDATE ON "wallet_entries" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER wallet_entries_no_delete BEFORE DELETE ON "wallet_entries" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER receipts_no_update       BEFORE UPDATE ON "receipts"       FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER receipts_no_delete       BEFORE DELETE ON "receipts"       FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Leiloeiro dar lance é regra de negócio que precisa ser impossível mesmo
-- se uma checagem na camada de app for ignorada por engano.
CREATE OR REPLACE FUNCTION forbid_auctioneer_bid() RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT role FROM "users" WHERE id = NEW.bidder_id) = 'auctioneer' THEN
    RAISE EXCEPTION 'AUCTIONEER_CANNOT_BID';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bids_role_check BEFORE INSERT ON "bids" FOR EACH ROW EXECUTE FUNCTION forbid_auctioneer_bid();
