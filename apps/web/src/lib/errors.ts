import { ApiError } from "../api/client";

// Mensagens em português para os códigos estáveis da API ({ code, message }).
// A API devolve `message` em inglês (para logs e integrações); o que o usuário lê
// vem daqui, sempre indexado pelo `code`, nunca pelo texto.
const MESSAGES: Record<string, string> = {
  // Lance
  BID_BELOW_MIN: "Seu lance está abaixo do mínimo para este lote.",
  INSUFFICIENT_FUNDS: "Saldo disponível insuficiente para este lance.",
  ALREADY_LEADING: "Você já está com o maior lance neste lote.",
  LOT_NOT_STARTED: "Este lote ainda não abriu para lances.",
  LOT_CLOSED: "Este lote já foi encerrado.",
  AUCTIONEER_CANNOT_BID: "Leiloeiros não podem dar lances.",
  // Leiloeiro
  LOT_HAS_BIDS: "Não é possível cancelar um lote que já recebeu lances.",
  LOT_NOT_CANCELLABLE: "Este lote não pode mais ser cancelado.",
  LOT_NOT_EDITABLE: "Este lote não pode mais ser editado: ele já recebeu lances ou terminou.",
  // Conta e acesso
  INVALID_CREDENTIALS: "E-mail ou senha incorretos.",
  INVALID_CURRENT_PASSWORD: "A senha atual está incorreta.",
  EMAIL_ALREADY_IN_USE: "Este e-mail já está cadastrado.",
  UNAUTHORIZED: "Sua sessão expirou. Entre novamente.",
  FORBIDDEN: "Você não tem permissão para fazer isso.",
  // Gerais
  NOT_FOUND: "Não encontramos o que você procurava.",
  VALIDATION_ERROR: "Confira os dados informados.",
  NETWORK_ERROR: "Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.",
  INTERNAL_ERROR: "Algo deu errado do nosso lado. Tente novamente em instantes.",
};

const FALLBACK = "Algo inesperado aconteceu. Tente novamente.";

export function messageForCode(code: string): string {
  return MESSAGES[code] ?? FALLBACK;
}

// Qualquer erro capturado numa tela vira texto para o usuário.
export function describeError(error: unknown): string {
  return error instanceof ApiError ? messageForCode(error.code) : FALLBACK;
}
