import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { cancelLot, myAuctionsQueryKey, type MyLot } from "../api/auctioneer";
import { describeError } from "../lib/errors";
import { Button } from "../ui/Button";
import "./CancelLotAction.css";

export function CancelLotAction({ lot, onCancelled }: { lot: MyLot; onCancelled?: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => cancelLot(lot.id),
    onSuccess: () => {
      setConfirming(false);
      setError(null);
      onCancelled?.();
      // O lote some da vitrine e muda de estado aqui; a lista pública também se atualiza.
      void queryClient.invalidateQueries({ queryKey: myAuctionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["lots"] });
    },
    onError: (err) => {
      setError(describeError(err));
      // O lote pode ter recebido um lance enquanto a tela estava aberta: relê o estado real.
      void queryClient.invalidateQueries({ queryKey: myAuctionsQueryKey });
    },
  });

  // Cancelar é irreversível: pede uma segunda confirmação, na própria linha.
  if (!confirming) {
    return (
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Cancelar lote
      </Button>
    );
  }

  return (
    <div className="cancel-confirm" role="group" aria-label={`Confirmar cancelamento de ${lot.title}`}>
      <Button variant="danger" loading={mutation.isPending} onClick={() => mutation.mutate()}>
        Confirmar cancelamento
      </Button>
      <Button variant="secondary" disabled={mutation.isPending} onClick={() => setConfirming(false)}>
        Manter lote
      </Button>
      {error && (
        <p className="t-caption cancel-confirm__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
