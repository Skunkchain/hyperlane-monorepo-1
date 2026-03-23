import { Request, Response, Router } from 'express';
import type { Address, Hex } from 'viem';
import { z } from 'zod';

import { ApiError } from '../middleware/errorHandler.js';
import type { QuoteService } from '../services/quoteService.js';
import type { TransientQuoteParams } from '../services/quoteService.js';

const QuoteQuerySchema = z
  .object({
    origin: z.string().min(1),
    warpRoute: z.string().startsWith('0x').length(42),
    destination: z.string().regex(/^\d+$/),
    recipient: z.string().startsWith('0x').length(66),
    sender: z.string().startsWith('0x').length(42).optional(),
    clientSalt: z.string().startsWith('0x').length(66).optional(),
  })
  .refine(
    (data) =>
      (data.sender && data.clientSalt) || (!data.sender && !data.clientSalt),
    { message: 'sender and clientSalt must both be provided or both omitted' },
  );

export function createQuoteRouter(quoteService: QuoteService): Router {
  const router = Router();

  // GET /quote?origin=<chain>&warpRoute=<address>&destination=<domainId>&recipient=<bytes32>
  //            [&sender=<address>&clientSalt=<bytes32>]  (optional, for transient quotes)
  router.get('/', async (req: Request, res: Response) => {
    const parsed = QuoteQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const messages = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new ApiError(messages, 400);
    }

    const { origin, warpRoute, destination, recipient, sender, clientSalt } =
      parsed.data;

    const ctx = quoteService.getChainContext(origin);
    if (!ctx) {
      throw new ApiError(`Unknown origin chain: ${origin}`, 400);
    }

    const destDomain = parseInt(destination, 10);

    const transient: TransientQuoteParams | undefined =
      sender && clientSalt
        ? { sender: sender as Address, clientSalt: clientSalt as Hex }
        : undefined;

    const quoteResponse = await quoteService.getQuote(
      origin,
      warpRoute as Address,
      destDomain,
      recipient as Hex,
      transient,
    );

    res.json(quoteResponse);
  });

  return router;
}
