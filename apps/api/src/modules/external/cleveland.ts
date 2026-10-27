import { z } from "zod";
import fallbackData from "../../data/fallback-artworks.json" with { type: "json" };

// Busca de obras na API aberta do Cleveland Museum of Art (CC0). Essa API é
// tratada como INSTÁVEL (exigência do desafio): só o painel do leiloeiro a usa,
// com timeout curto, tratamento de qualquer falha e degradação. Nunca lança erro
// para a rota: o pior caso é uma resposta `degraded` (com o fallback local).
//
// Por que não o Art Institute of Chicago: a API e o IIIF dele ficam atrás de um
// Cloudflare Managed Challenge (403 para clientes sem navegador, e <img> não
// resolve o desafio), então as imagens não carregavam. Ver DECISIONS.md.

const SEARCH_URL = "https://openaccess-api.clevelandart.org/api/artworks/";
const FIELDS = [
  "id",
  "title",
  "creators",
  "creation_date",
  "technique",
  "measurements",
  "creditline",
  "accession_number",
  "share_license_status",
  "images",
].join(",");

export const SEARCH_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 100;
// Depois de uma falha, nas próximas buscas nem tenta a API por um tempo: senão,
// bloqueada pelo Cloudflare, TODA busca esperaria o timeout de 3s antes de cair
// no fallback.
const FAILURE_COOLDOWN_MS = 30_000;

export type SearchReason = "timeout" | "unavailable";

export type ArtworkItem = {
  externalId: string;
  title: string;
  imageUrl: string;
  artistDisplay: string | null;
  dateDisplay: string | null;
  mediumDisplay: string | null;
  isPublicDomain: boolean;
  // Snapshot que o lote guarda (lots.attributes); a API externa nunca é
  // consultada de novo depois que o lote é criado.
  attributes: {
    artist_display: string | null;
    date_display: string | null;
    medium_display: string | null;
    dimensions: string | null;
    credit_line: string | null;
    is_public_domain: boolean;
    main_reference_number: string | null;
  };
};

export type SearchResult = {
  items: ArtworkItem[];
  source: "cleveland" | "local";
  degraded: boolean;
  reason: SearchReason | null;
};

const nullableText = z.string().nullish().transform((value) => value ?? null);

// Formato normalizado (o mesmo de data/fallback-artworks.json e do seed).
const artworkSchema = z.object({
  id: z.number().int(),
  title: z.string().min(1),
  image_url: z.string().url(), // sem imagem não há lote que se possa exibir
  is_public_domain: z.boolean(),
  artist_display: nullableText,
  date_display: nullableText,
  medium_display: nullableText,
  dimensions: nullableText,
  credit_line: nullableText,
  main_reference_number: nullableText,
});
type RawArtwork = z.infer<typeof artworkSchema>;

// Formato cru da API do Cleveland -> formato normalizado. Campos opcionais
// ausentes viram null; falta de imagem ou título faz o registro ser descartado.
const clevelandSchema = z
  .object({
    id: z.number().int(),
    title: z.string().min(1),
    images: z.object({ web: z.object({ url: z.string().url() }) }),
    creators: z.array(z.object({ description: z.string().nullish() })).nullish(),
    creation_date: nullableText,
    technique: nullableText,
    measurements: nullableText,
    creditline: nullableText,
    accession_number: nullableText,
    share_license_status: nullableText,
  })
  .transform(
    (raw): RawArtwork => ({
      id: raw.id,
      title: raw.title,
      // Imagem carregada pelo BROWSER do usuário (nunca proxeada pelo backend).
      image_url: raw.images.web.url,
      is_public_domain: raw.share_license_status === "CC0",
      artist_display: (raw.creators ?? []).map((c) => c.description).filter(Boolean).join("; ") || null,
      date_display: raw.creation_date,
      medium_display: raw.technique,
      dimensions: raw.measurements,
      credit_line: raw.creditline,
      main_reference_number: raw.accession_number,
    }),
  );

function toItem(raw: RawArtwork): ArtworkItem {
  return {
    externalId: String(raw.id),
    title: raw.title,
    imageUrl: raw.image_url,
    artistDisplay: raw.artist_display,
    dateDisplay: raw.date_display,
    mediumDisplay: raw.medium_display,
    isPublicDomain: raw.is_public_domain,
    attributes: {
      artist_display: raw.artist_display,
      date_display: raw.date_display,
      medium_display: raw.medium_display,
      dimensions: raw.dimensions,
      credit_line: raw.credit_line,
      is_public_domain: raw.is_public_domain,
      main_reference_number: raw.main_reference_number,
    },
  };
}

// Tolerante: um registro fora do formato (ou sem imagem) é descartado, sem
// derrubar a lista inteira.
function parseItems(rows: unknown, schema: z.ZodType<RawArtwork, z.ZodTypeDef, unknown>): ArtworkItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [toItem(parsed.data)] : [];
  });
}

const localArtworks = parseItems(fallbackData, artworkSchema);

function searchLocal(q: string, limit: number): ArtworkItem[] {
  const needle = q.toLowerCase();
  return localArtworks
    .filter((item) => `${item.title} ${item.artistDisplay ?? ""}`.toLowerCase().includes(needle))
    .slice(0, limit);
}

// --- estado em memória (instância única, como o resto do projeto) ---
const cache = new Map<string, { at: number; items: ArtworkItem[] }>();
let cooldown: { until: number; reason: SearchReason } | null = null;

export function resetExternalState(): void {
  cache.clear();
  cooldown = null;
}

function degrade(q: string, limit: number, reason: SearchReason): SearchResult {
  return { items: searchLocal(q, limit), source: "local", degraded: true, reason };
}

export async function searchArtworks(
  q: string,
  limit: number,
  options: { timeoutMs?: number } = {},
): Promise<SearchResult> {
  const key = `${q.toLowerCase()}|${limit}`;
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return { items: hit.items, source: "cleveland", degraded: false, reason: null };
  }
  if (cooldown && now < cooldown.until) return degrade(q, limit, cooldown.reason);

  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit * 3)); // folga: itens inválidos são descartados
  url.searchParams.set("has_image", "1");
  url.searchParams.set("fields", FIELDS);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? SEARCH_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "leilao-online/1.0 (technical assessment)" },
    });
    if (!response.ok) throw new Error(`Cleveland API responded ${response.status}`);
    const body: unknown = await response.json();
    const rows = typeof body === "object" && body !== null ? (body as { data?: unknown }).data : undefined;
    const items = parseItems(rows, clevelandSchema).slice(0, limit);

    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now, items });
    cooldown = null;
    return { items, source: "cleveland", degraded: false, reason: null };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const reason: SearchReason = timedOut ? "timeout" : "unavailable";
    cooldown = { until: now + FAILURE_COOLDOWN_MS, reason };
    return degrade(q, limit, reason);
  }
}
