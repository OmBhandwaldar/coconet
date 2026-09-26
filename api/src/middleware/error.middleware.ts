import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';
import { AppError } from '../errors/AppError.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code ?? 'ERROR', message: err.message },
      correlationId: req.correlationId,
    });
    return;
  }

  // body-parser and other http-errors-style middleware attach a status to the
  // error (413 entity.too.large, 400 entity.parse.failed). Without this, a caller
  // sending an oversized or malformed body gets a 500 and we log it as our fault.
  const status = (err as { status?: number; statusCode?: number }).status
    ?? (err as { statusCode?: number }).statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code = (err as { type?: string }).type === 'entity.too.large'
      ? 'PAYLOAD_TOO_LARGE'
      : 'BAD_REQUEST';
    logger.warn({ status, code, correlationId: req.correlationId }, 'Rejected malformed request');
    res.status(status).json({
      success: false,
      error: { code, message: err.message },
      correlationId: req.correlationId,
    });
    return;
  }

  logger.error({ err, correlationId: req.correlationId }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    correlationId: req.correlationId,
  });
}
