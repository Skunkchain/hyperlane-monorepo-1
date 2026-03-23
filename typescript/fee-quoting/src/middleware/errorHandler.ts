import { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number = 500,
  ) {
    super(message);
  }
}

export function createErrorHandler(logger: Logger) {
  return function errorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
  ) {
    if (res.headersSent) {
      return next(err);
    }

    const status = err instanceof ApiError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : 'Internal Server Error';

    logger.error({ error: err }, 'Error handling request');
    res.status(status).json({ message });
  };
}
