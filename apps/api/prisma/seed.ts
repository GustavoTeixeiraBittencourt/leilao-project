import { readFileSync } from "node:fs";
import { prisma } from "../src/db/client.js";
import { auditLot } from "../src/modules/audit/service.js";
import { signup } from "../src/modules/auth/service.js";
import { placeBid } from "../src/modules/bids/service.js";
import { settleLot } from "../src/modules/settlement/service.js";

// Seed de demonstração. RESETA o banco inteiro (TRUNCATE) e recria:
//   1 leiloeiro, 2 licitantes com saldo, lotes ao vivo (com e sem lances),
//   agendados e encerrados já liquidados (vendido e sem lances).
// Os lotes encerrados NÃO são inseridos "prontos": passam pelo código real
// (placeBid -> settleLot), então hash chain, selo e comprovante são válidos e a
// auditoria dá "íntegro". Os horários são relativos ao momento do seed; os
// lotes ao vivo vencem com o tempo, e basta rodar o seed de novo.

type Artwork = {
  id: number;
  title: string;
  image_url: string;
  is_public_domain: boolean;
  artist_display: string;
  date_display: string;
  medium_display: string;
  dimensions: string;
  credit_line: string;
  main_reference_number: string;
};

const PASSWORD = "demo12345";
export const DEMO_ACCOUNTS = {
  auctioneer: { email: "leiloeiro@demo.com", displayName: "Casa Leiloeira Demo" },
  bidder1: { email: "licitante1@demo.com", displayName: "Licitante Um" },
  bidder2: { email: "licitante2@demo.com", displayName: "Licitante Dois" },
} as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Dados reais da API aberta do Cleveland Museum of Art (CC0), salvos no
// repositório: o seed não faz nenhuma chamada de rede.
const artworks: Artwork[] = JSON.parse(
  readFileSync(new URL("../src/data/fallback-artworks.json", import.meta.url), "utf8"),
);

function guardAgainstAccidentalReset() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED_RESET !== "1") {
    throw new Error("Refusing to reset the database in production. Set ALLOW_SEED_RESET=1 to force it.");
  }
}

async function resetDatabase() {
  // Única exceção à regra "SQL cru só em src/db/locks.ts": é um script de
  // desenvolvimento, não código de runtime. TRUNCATE não dispara as triggers
  // append-only (elas são por linha) e CASCADE cobre as FKs.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "receipts", "wallet_entries", "bids", "lots", "users" RESTART IDENTITY CASCADE',
  );
}

async function createLot(
  auctioneerId: string,
  artwork: Artwork,
  options: { startsInMs: number; endsInMs: number; startingBidCents: number; minIncrementCents: number },
) {
  const now = Date.now();
  return prisma.lot.create({
    data: {
      auctioneerId,
      externalSource: "cleveland",
      externalId: String(artwork.id),
      title: artwork.title,
      imageUrl: artwork.image_url,
      // Snapshot imutável: a API externa nunca é consultada de novo.
      attributes: {
        artist_display: artwork.artist_display,
        date_display: artwork.date_display,
        medium_display: artwork.medium_display,
        dimensions: artwork.dimensions,
        credit_line: artwork.credit_line,
        is_public_domain: artwork.is_public_domain,
        main_reference_number: artwork.main_reference_number,
      },
      startingBidCents: BigInt(options.startingBidCents),
      minIncrementCents: BigInt(options.minIncrementCents),
      startsAt: new Date(now + options.startsInMs),
      endsAt: new Date(now + options.endsInMs),
    },
  });
}

// Alterna os dois licitantes subindo de incremento em incremento; o último a
// cobrir fica na liderança. `rounds` lances no total.
async function bidUp(
  lot: { id: string },
  startingBidCents: number,
  minIncrementCents: number,
  bidders: [string, string],
  rounds: number,
) {
  for (let i = 0; i < rounds; i++) {
    await placeBid(bidders[i % 2]!, lot.id, startingBidCents + i * minIncrementCents);
  }
}

// Encerra de verdade: empurra ends_at para logo depois do último lance (para
// o histórico não mostrar lance "depois do fim") e roda a liquidação real.
async function closeNow(lotId: string) {
  const last = await prisma.bid.findFirst({ where: { lotId }, orderBy: { seq: "desc" } });
  const endsAt = new Date((last?.placedAt.getTime() ?? Date.now()) + 1);
  await prisma.lot.update({ where: { id: lotId }, data: { endsAt } });
  await settleLot(lotId);
}

async function main() {
  guardAgainstAccidentalReset();
  if (artworks.length < 10) throw new Error("src/data/fallback-artworks.json must have at least 10 artworks");
  await resetDatabase();

  const auctioneer = await signup({ ...DEMO_ACCOUNTS.auctioneer, password: PASSWORD, role: "auctioneer" });
  const bidder1 = await signup({ ...DEMO_ACCOUNTS.bidder1, password: PASSWORD, role: "bidder" });
  const bidder2 = await signup({ ...DEMO_ACCOUNTS.bidder2, password: PASSWORD, role: "bidder" });

  // Saldo simulado (centavos): R$ 50.000,00 e R$ 30.000,00.
  await prisma.walletEntry.createMany({
    data: [
      { userId: bidder1.id, kind: "deposit", amountCents: 5_000_000n },
      { userId: bidder2.id, kind: "deposit", amountCents: 3_000_000n },
    ],
  });
  const pair: [string, string] = [bidder1.id, bidder2.id];
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9] = artworks as [
    Artwork, Artwork, Artwork, Artwork, Artwork, Artwork, Artwork, Artwork, Artwork, Artwork,
  ];

  // --- Ao vivo, com lances ---
  const live1 = await createLot(auctioneer.id, a0, { startsInMs: -2 * HOUR, endsInMs: 6 * HOUR, startingBidCents: 150_000, minIncrementCents: 10_000 });
  await bidUp(live1, 150_000, 10_000, pair, 5);
  const live2 = await createLot(auctioneer.id, a1, { startsInMs: -1 * DAY, endsInMs: 2 * DAY, startingBidCents: 80_000, minIncrementCents: 5_000 });
  await bidUp(live2, 80_000, 5_000, pair, 3);
  // Termina em 20 min: bom para demonstrar a contagem regressiva e o anti-sniping.
  const live3 = await createLot(auctioneer.id, a2, { startsInMs: -3 * HOUR, endsInMs: 20 * MINUTE, startingBidCents: 250_000, minIncrementCents: 25_000 });
  await bidUp(live3, 250_000, 25_000, pair, 2);
  // Ao vivo, ainda sem lances.
  await createLot(auctioneer.id, a3, { startsInMs: -30 * MINUTE, endsInMs: 4 * DAY, startingBidCents: 60_000, minIncrementCents: 5_000 });

  // --- Agendados ---
  await createLot(auctioneer.id, a4, { startsInMs: 2 * HOUR, endsInMs: 2 * DAY, startingBidCents: 120_000, minIncrementCents: 10_000 });
  await createLot(auctioneer.id, a5, { startsInMs: 1 * DAY, endsInMs: 3 * DAY, startingBidCents: 300_000, minIncrementCents: 20_000 });

  // --- Encerrados, liquidados pelo código real ---
  const soldA = await createLot(auctioneer.id, a6, { startsInMs: -3 * HOUR, endsInMs: 1 * HOUR, startingBidCents: 90_000, minIncrementCents: 10_000 });
  await bidUp(soldA, 90_000, 10_000, pair, 4);
  await closeNow(soldA.id);
  const soldB = await createLot(auctioneer.id, a7, { startsInMs: -3 * HOUR, endsInMs: 1 * HOUR, startingBidCents: 200_000, minIncrementCents: 20_000 });
  await bidUp(soldB, 200_000, 20_000, pair, 2);
  await closeNow(soldB.id);
  const unsold = await createLot(auctioneer.id, a8, { startsInMs: -3 * HOUR, endsInMs: 1 * HOUR, startingBidCents: 500_000, minIncrementCents: 50_000 });
  await closeNow(unsold.id);

  // Um segundo lote sem lances, ao vivo, só para a vitrine não ficar com um único "vazio".
  await createLot(auctioneer.id, a9, { startsInMs: -10 * MINUTE, endsInMs: 7 * DAY, startingBidCents: 40_000, minIncrementCents: 5_000 });

  // Conferência final: toda a cadeia que acabamos de gerar precisa fechar.
  const lots = await prisma.lot.findMany({ select: { id: true, title: true, status: true, endsAt: true, startsAt: true } });
  for (const lot of lots) {
    const audit = await auditLot(lot.id);
    if (audit.verdict !== "intact") throw new Error(`Seed produced a non-intact lot: ${lot.title}`);
  }

  const receipts = await prisma.receipt.findMany({ select: { publicToken: true, lot: { select: { title: true } } } });
  console.log(`\nSeed OK: ${lots.length} lots, 3 users. Every audit verdict is intact.\n`);
  console.log("Contas de teste (senha para todas: %s):", PASSWORD);
  for (const account of Object.values(DEMO_ACCOUNTS)) console.log(`  ${account.email}`);
  console.log("\nComprovantes:");
  for (const receipt of receipts) console.log(`  /receipts/${receipt.publicToken}   (${receipt.lot.title})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
