import { Link } from "react-router-dom";
import type { Lot } from "../api/lots";
import { useNow } from "../hooks/useNow";
import { formatCountdownShort, remainingMs } from "../lib/clock";
import { bidsLabel, firstLine, formatDayAt, formatDayMonth, formatMoney } from "../lib/format";
import { StatusBadge } from "../ui/StatusBadge";
import { LotImage } from "./LotImage";
import "./AuctionCard.css";

// Cartão de leilão do Figma. "featured" é o destaque editorial da vitrine; "compact"
// é a grade secundária (e os resultados). A fase vem do SERVIDOR (lot.phase); o
// cliente só anima a contagem a partir do offset do relógio do servidor.
function TimeLabel({ lot }: { lot: Lot }) {
  useNow(); // re-renderiza a cada segundo (relógio compartilhado)
  if (lot.phase === "live") {
    const left = remainingMs(lot.endsAt);
    return <span className="t-label-s text-secondary num">{left > 0 ? `Termina em ${formatCountdownShort(left)}` : "Encerrando…"}</span>;
  }
  if (lot.phase === "scheduled") {
    return <span className="t-label-s text-secondary num">Abre {formatDayAt(lot.startsAt)}</span>;
  }
  return <span className="t-caption text-secondary num">Encerrou {formatDayMonth(lot.endsAt)}</span>;
}

// Rótulo e valor do bloco de preço, conforme a fase.
function priceBlock(lot: Lot): { label: string; cents: number | null; text?: string } {
  if (lot.phase === "ended") {
    return lot.winnerAlias && lot.finalPriceCents !== null
      ? { label: "Arrematado por", cents: lot.finalPriceCents }
      : { label: "Resultado", cents: null, text: "Sem lances" };
  }
  if (lot.phase === "live" && lot.currentBidCents !== null) return { label: "Lance atual", cents: lot.currentBidCents };
  return { label: "Lance inicial", cents: lot.startingBidCents };
}

export function AuctionCard({ lot, variant = "compact" }: { lot: Lot; variant?: "featured" | "compact" }) {
  const artist = firstLine(lot.attributes.artist_display);
  const price = priceBlock(lot);
  const featured = variant === "featured";

  return (
    <Link to={`/lots/${lot.id}`} className={`card card--${variant}`}>
      <LotImage src={lot.imageUrl} alt={artist ? `${lot.title}, ${artist}` : lot.title} className="card__image" />
      <div className="card__status">
        <StatusBadge phase={lot.phase} />
        <TimeLabel lot={lot} />
      </div>
      <h3 className={featured ? "t-h1" : "t-h3"}>{lot.title}</h3>
      {artist && <p className="t-body-s text-secondary">{artist}</p>}
      <div className="card__bid">
        <div className="card__amount">
          <span className="t-overline text-secondary">{price.label}</span>
          <span className={featured ? "t-number-l" : "t-number-m"}>
            {price.text ?? formatMoney(price.cents ?? 0)}
          </span>
        </div>
        <span className="t-body-s text-secondary num">{lot.phase === "ended" ? `${lot.bidCount} lances` : bidsLabel(lot.bidCount)}</span>
      </div>
    </Link>
  );
}

export function AuctionCardSkeleton() {
  return (
    <div className="card card--compact" aria-hidden="true">
      <div className="skeleton card__image" />
      <div className="skeleton" style={{ height: 16, width: "60%" }} />
      <div className="skeleton" style={{ height: 28, width: "80%" }} />
      <div className="skeleton" style={{ height: 36, width: "50%" }} />
    </div>
  );
}
