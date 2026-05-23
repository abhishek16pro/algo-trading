/**
 * Domain errors. The api-gateway maps these to HTTP status codes.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, statusCode: number, code: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class AuthError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, 'AUTH_ERROR');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(`${entity}${id ? ` ${id}` : ''} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class RiskGateError extends AppError {
  readonly reason: string;
  constructor(reason: string, details?: unknown) {
    super(`Risk gate blocked: ${reason}`, 422, 'RISK_BLOCKED', details);
    this.reason = reason;
  }
}

export class BrokerError extends AppError {
  readonly brokerId: string;
  constructor(brokerId: string, message: string, details?: unknown) {
    super(`[${brokerId}] ${message}`, 502, 'BROKER_ERROR', details);
    this.brokerId = brokerId;
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMITED');
  }
}
