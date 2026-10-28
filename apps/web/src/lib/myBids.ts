import type { BidStatus, MyBid } from "../api/wins";

// Regras puras da tela "Meus arremates" (fora dos componentes para testar sem React).

export type BidTab = "all" | "active" | "won" | "lost";

export const BID_TABS: { tab: BidTab; label: string }[] = [
  { tab: "all", label: "Todos" },
  { tab: "active", label: "Em disputa" },
  { tab: "won", label: "Arrematados" },
  { tab: "lost", label: "Não arrematados" },
];

// "Em disputa" = lotes abertos em que dei lance (liderando ou superado: ainda dá para cobrir).
const TAB_STATUSES: Record<Exclude<BidTab, "all">, BidStatus[]> = {
  active: ["leading", "outbid"],
  won: ["won"],
  lost: ["lost"],
};

// O `?tab=` vem da URL e pode ser qualquer coisa: valor desconhecido cai em "Todos".
export function parseBidTab(value: string | null): BidTab {
  return BID_TABS.some((item) => item.tab === value) ? (value as BidTab) : "all";
}

export function filterByTab(bids: MyBid[], tab: BidTab): MyBid[] {
  if (tab === "all") return bids;
  const allowed = TAB_STATUSES[tab];
  return bids.filter((bid) => allowed.includes(bid.status));
}

export function countByTab(bids: MyBid[]): Record<BidTab, number> {
  return {
    all: bids.length,
    active: filterByTab(bids, "active").length,
    won: filterByTab(bids, "won").length,
    lost: filterByTab(bids, "lost").length,
  };
}

const STATUS_LABEL: Record<BidStatus, string> = {
  leading: "Liderando",
  outbid: "Superado",
  won: "Arrematado",
  lost: "Não arrematado",
};

export function bidStatusText(status: BidStatus): string {
  return STATUS_LABEL[status];
}

// O que o botão principal de cada linha faz. Arrematado leva ao comprovante (o requisito
// do desafio); superado num lote ainda ao vivo convida a cobrir; o resto vai para a sala
// ou, depois que o lote fechou sem vitória, para a auditoria.
export type BidAction = "receipt" | "cover" | "room" | "audit";

export function bidAction(bid: Pick<MyBid, "status" | "phase" | "receiptToken">): BidAction {
  if (bid.status === "won") return bid.receiptToken ? "receipt" : "audit";
  if (bid.status === "lost") return "audit";
  if (bid.status === "outbid" && bid.phase === "live") return "cover";
  return "room";
}

// Texto da aba vazia: cada aba explica o que falta, não um "nada aqui" genérico.
export function emptyCopy(tab: BidTab): { title: string; text: string } {
  switch (tab) {
    case "active":
      return { title: "Nenhum lote em disputa agora", text: "Os lotes em que você dá lance e ainda estão abertos aparecem aqui." };
    case "won":
      return {
        title: "Você ainda não arrematou nenhum lote",
        text: "Quando você vencer um leilão, ele aparece aqui com o comprovante e o link para compartilhar.",
      };
    case "lost":
      return { title: "Nenhum lote perdido", text: "Os lotes encerrados em que outra pessoa venceu aparecem aqui." };
    default:
      return {
        title: "Você ainda não deu nenhum lance",
        text: "Quando você der um lance, o lote aparece aqui. Se vencer, ele ganha comprovante e link para compartilhar.",
      };
  }
}
