import type { BidStatus } from "../api/wins";
import { bidStatusText } from "../lib/myBids";
import "./StatusBadge.css";
import "./BidStatusBadge.css";

// Situação do MEU lance num lote. Como no StatusBadge, o estado nunca depende só da cor:
// cada um tem um símbolo (decorativo) e o rótulo, que é o que se lê.
const SYMBOL: Record<BidStatus, string> = {
  leading: "▲",
  outbid: "▼",
  won: "✓",
  lost: "×",
};

export function BidStatusBadge({ status }: { status: BidStatus }) {
  return (
    <span className={`badge bid-badge bid-badge--${status} t-label-s`}>
      <span aria-hidden="true">{SYMBOL[status]}</span> {bidStatusText(status)}
    </span>
  );
}
