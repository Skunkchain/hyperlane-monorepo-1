import { z } from 'zod';

import { DEFAULT_PORT, DEFAULT_QUOTE_EXPIRY_SECONDS } from './constants.js';

export const ServerConfigSchema = z.object({
  signerKey: z.string().startsWith('0x').min(66).max(66),
  warpRouteId: z.string().min(1),
  registryUri: z.string().min(1),
  apiKeys: z.array(z.string().min(1)).min(1),
  port: z.number().int().positive().default(DEFAULT_PORT),
  quoteExpiry: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_QUOTE_EXPIRY_SECONDS),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
