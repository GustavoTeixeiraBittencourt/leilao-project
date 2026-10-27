export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "EMAIL_ALREADY_IN_USE"
  | "INVALID_CREDENTIALS"
  | "INVALID_CURRENT_PASSWORD"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BID_BELOW_MIN"
  | "INSUFFICIENT_FUNDS"
  | "ALREADY_LEADING"
  | "LOT_NOT_STARTED"
  | "LOT_CLOSED"
  | "LOT_HAS_BIDS"
  | "LOT_NOT_CANCELLABLE"
  | "AUCTIONEER_CANNOT_BID"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  VALIDATION_ERROR: 400,
  EMAIL_ALREADY_IN_USE: 409,
  INVALID_CREDENTIALS: 401,
  // 422 e não 401: a pessoa ESTÁ autenticada, só errou a senha atual. Um 401 aqui seria
  // lido pelo front como sessão expirada (ver apiFetch).
  INVALID_CURRENT_PASSWORD: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BID_BELOW_MIN: 422,
  INSUFFICIENT_FUNDS: 422,
  ALREADY_LEADING: 422,
  LOT_NOT_STARTED: 422,
  LOT_CLOSED: 422,
  LOT_HAS_BIDS: 409,
  LOT_NOT_CANCELLABLE: 409,
  AUCTIONEER_CANNOT_BID: 403,
  INTERNAL_ERROR: 500,
};

// Toda recusa de regra de negócio (lance, auth, etc.) usa este formato
// padrão { code, message } em vez de mensagens ad-hoc por rota.
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
  }
}
