import { useSyncExternalStore } from "react";

// Um único relógio de 1s compartilhado por TODOS os componentes que contam tempo
// (cada cartão de leilão tem uma contagem regressiva). Sem isto, 20 cartões
// criariam 20 setInterval; aqui há um só, que existe enquanto houver quem ouça.
let current = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

// Hora do CLIENTE, atualizada a cada segundo. Para saber quanto falta, combine com
// remainingMs() (lib/clock), que aplica o offset do relógio do servidor.
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
