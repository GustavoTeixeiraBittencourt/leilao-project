import type { LotPhase } from "../api/lots";
import "./StatusBadge.css";

// O estado nunca depende só da cor: cada fase tem um símbolo e um rótulo (regra de
// acessibilidade do Figma). Os símbolos são decorativos; o texto é o que se lê.
const BADGES: Record<LotPhase, { symbol: string; label: string }> = {
  live: { symbol: "●", label: "Ao vivo" },
  scheduled: { symbol: "○", label: "Agendado" },
  ended: { symbol: "■", label: "Encerrado" },
  cancelled: { symbol: "×", label: "Cancelado" },
};

export function StatusBadge({ phase }: { phase: LotPhase }) {
  const { symbol, label } = BADGES[phase];
  return (
    <span className={`badge badge--${phase} t-label-s`}>
      <span aria-hidden="true">{symbol}</span> {label}
    </span>
  );
}
