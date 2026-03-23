import cors from 'cors';
import express, { Express } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { Registry } from 'prom-client';
import type { Address, Hex } from 'viem';

import { IRegistry } from '@hyperlane-xyz/registry';
import {
  type ChainMetadata,
  getChainIdNumber,
  getDomainId,
} from '@hyperlane-xyz/sdk';
import { assert, createServiceLogger } from '@hyperlane-xyz/utils';

import packageJson from './package.json' with { type: 'json' };
import type { ServerConfig } from './src/config.js';
import { DEFAULT_PORT } from './src/constants.js';
import { createApiKeyAuth } from './src/middleware/apiKeyAuth.js';
import { createErrorHandler } from './src/middleware/errorHandler.js';
import { createMetrics } from './src/middleware/metrics.js';
import { createHealthRouter } from './src/routes/health.js';
import { createQuoteRouter } from './src/routes/quote.js';
import { QuoteService } from './src/services/quoteService.js';
import type { ChainQuoteContext } from './src/types.js';

export class FeeQuotingServer {
  app: Express;
  private readonly logger: Logger;
  private readonly config: ServerConfig;
  private ready = false;

  private constructor(config: ServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.app = express();
    this.app.set('trust proxy', true);
  }

  static async create(config: ServerConfig): Promise<FeeQuotingServer> {
    const logger = await createServiceLogger({
      service: 'fee-quoting',
      version: packageJson.version,
    });
    return new FeeQuotingServer(config, logger);
  }

  async start(registry: IRegistry) {
    // Metrics
    const register = new Registry();
    const metrics = createMetrics(register);

    // Middleware
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(pinoHttp({ logger: this.logger }));
    this.app.use(metrics.middleware);

    // Metrics endpoint (no auth)
    this.app.get('/metrics', async (_req, res) => {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    });

    // Health routes (no auth)
    this.app.use(createHealthRouter(() => this.ready));

    // Build chain contexts from registry
    const chainContexts = await this.buildChainContexts(registry);

    const quoteService = new QuoteService({
      signerKey: this.config.signerKey as Hex,
      quoteExpiry: this.config.quoteExpiry,
      chainContexts,
      logger: this.logger,
    });

    this.logger.info(
      {
        signerAddress: quoteService.signerAddress,
        chains: [...chainContexts.keys()],
        warpRouteId: this.config.warpRouteId,
      },
      'Quote service initialized',
    );

    // Quote routes (with API key auth)
    const apiKeyAuth = createApiKeyAuth(
      new Set(this.config.apiKeys),
      this.logger,
    );
    this.app.use('/quote', apiKeyAuth, createQuoteRouter(quoteService));

    // Error handler (must be last)
    this.app.use(createErrorHandler(this.logger));

    const port = this.config.port ?? DEFAULT_PORT;
    const server = this.app.listen(port, () => {
      this.ready = true;
      this.logger.info({ port }, 'Server running');
    });

    server.on('error', (error) => this.logger.error({ error }, 'Server error'));

    // Graceful shutdown
    const shutdown = () => {
      this.logger.info('Shutting down...');
      this.ready = false;
      server.close(() => {
        this.logger.info('Server closed');
        process.exit(0);
      });
      // Force exit after 10s if connections don't drain
      setTimeout(() => {
        this.logger.warn('Forcing shutdown after timeout');
        process.exit(1);
      }, 10_000).unref();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  private async buildChainContexts(
    registry: IRegistry,
  ): Promise<Map<string, ChainQuoteContext>> {
    const warpConfig = await registry.getWarpRoute(this.config.warpRouteId);
    assert(warpConfig, `Warp route not found: ${this.config.warpRouteId}`);

    const deployConfig = await registry.getWarpDeployConfig(
      this.config.warpRouteId,
    );

    const chainAddresses = await registry.getAddresses();
    assert(chainAddresses, 'Failed to load registry addresses');

    const contexts = new Map<string, ChainQuoteContext>();

    for (const token of warpConfig.tokens) {
      const { chainName } = token;

      const addresses = chainAddresses[chainName];
      assert(addresses, `No core addresses for chain: ${chainName}`);

      const igpAddress = addresses.interchainGasPaymaster;
      assert(igpAddress, `No IGP address for chain: ${chainName}`);

      const quotedCallsAddress = addresses.quotedCalls;
      assert(
        quotedCallsAddress,
        `No quotedCalls address for chain: ${chainName}`,
      );

      const metadata = await registry.getChainMetadata(chainName);
      assert(metadata, `No chain metadata for: ${chainName}`);

      const chainId = getChainIdNumber(metadata as ChainMetadata);
      const domainId = getDomainId(metadata as ChainMetadata);

      // Fee contract = tokenFee.token from warp deploy config
      const chainDeployConfig = deployConfig?.[chainName];
      const feeContractAddress =
        (chainDeployConfig as Record<string, unknown>)?.tokenFee &&
        ((chainDeployConfig as Record<string, Record<string, string>>).tokenFee
          ?.token as string | undefined);
      assert(
        feeContractAddress,
        `No fee contract (tokenFee.token) in deploy config for chain: ${chainName}`,
      );

      const feeTokenAddress = (token.igpTokenAddressOrDenom ??
        token.addressOrDenom ??
        '0x0000000000000000000000000000000000000000') as Address;

      contexts.set(chainName, {
        chainId,
        domainId,
        chainName,
        feeContractAddress: feeContractAddress as Address,
        igpAddress: igpAddress as Address,
        feeTokenAddress,
        quotedCallsAddress: quotedCallsAddress as Address,
      });
    }

    return contexts;
  }
}
