import { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

import { ApiError } from './errorHandler.js';

export function createApiKeyAuth(apiKeys: Set<string>, logger: Logger) {
  return function apiKeyAuth(req: Request, _res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      logger.warn({ ip: req.ip }, 'Missing or invalid Authorization header');
      throw new ApiError('Missing or invalid Authorization header', 401);
    }

    const key = authHeader.slice(7);
    if (!apiKeys.has(key)) {
      logger.warn({ ip: req.ip }, 'Invalid API key');
      throw new ApiError('Invalid API key', 401);
    }

    next();
  };
}
