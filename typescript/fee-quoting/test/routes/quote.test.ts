import { expect } from 'chai';
import express, { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import type { Address, Hex } from 'viem';

import { ZERO_BYTES32 } from '../../src/constants.js';
import { createApiKeyAuth } from '../../src/middleware/apiKeyAuth.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createQuoteRouter } from '../../src/routes/quote.js';
import { QuoteService } from '../../src/services/quoteService.js';
import type { ChainQuoteContext } from '../../src/types.js';

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const TEST_API_KEY = 'test-api-key-123';

const TEST_CHAIN_CONTEXT: ChainQuoteContext = {
  chainId: 1,
  domainId: 1,
  chainName: 'ethereum',
  feeContractAddress: '0x1111111111111111111111111111111111111111' as Address,
  igpAddress: '0x2222222222222222222222222222222222222222' as Address,
  feeTokenAddress: '0x3333333333333333333333333333333333333333' as Address,
  quotedCallsAddress: '0x4444444444444444444444444444444444444444' as Address,
};

const WARP_ROUTE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RECIPIENT =
  '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SENDER = '0xcccccccccccccccccccccccccccccccccccccccc';
const ALL_PARAMS = `origin=ethereum&warpRoute=${WARP_ROUTE}&destination=42161&recipient=${RECIPIENT}`;

function createTestApp(): Express {
  const chainContexts = new Map<string, ChainQuoteContext>();
  chainContexts.set('ethereum', TEST_CHAIN_CONTEXT);

  const quoteService = new QuoteService({
    signerKey: TEST_PRIVATE_KEY,
    quoteExpiry: 300,
    chainContexts,
    logger: pino({ level: 'silent' }),
  });

  const app = express();
  app.use(express.json());

  const apiKeyAuth = createApiKeyAuth(
    new Set([TEST_API_KEY]),
    pino({ level: 'silent' }),
  );
  app.use('/quote', apiKeyAuth, createQuoteRouter(quoteService));
  app.use(createErrorHandler(pino({ level: 'silent' })));

  return app;
}

describe('Quote Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
  });

  describe('GET /quote', () => {
    it('returns 401 without API key', async () => {
      const res = await request(app).get(`/quote?${ALL_PARAMS}`).expect(401);
      expect(res.body.message).to.include('Authorization');
    });

    it('returns 401 with invalid API key', async () => {
      await request(app)
        .get(`/quote?${ALL_PARAMS}`)
        .set('Authorization', 'Bearer wrong-key')
        .expect(401);
    });

    it('returns array of submit quote commands', async () => {
      const res = await request(app)
        .get(`/quote?${ALL_PARAMS}`)
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .expect(200);

      expect(res.body).to.be.an('array').with.lengthOf(2);
      expect(res.body[0]).to.have.property('quoter');
      expect(res.body[0]).to.have.property('quote');
      expect(res.body[0]).to.have.property('signature');
      // Standing: expiry > issuedAt
      expect(res.body[0].quote.expiry).to.be.greaterThan(
        res.body[0].quote.issuedAt,
      );
    });

    it('returns transient quotes when sender and clientSalt provided', async () => {
      const params = `${ALL_PARAMS}&sender=${SENDER}&clientSalt=${ZERO_BYTES32}`;
      const res = await request(app)
        .get(`/quote?${params}`)
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .expect(200);

      expect(res.body).to.be.an('array').with.lengthOf(2);
      // Transient: expiry == issuedAt
      expect(res.body[0].quote.expiry).to.equal(res.body[0].quote.issuedAt);
      // Submitter is QuotedCalls
      expect(res.body[0].quote.submitter.toLowerCase()).to.equal(
        TEST_CHAIN_CONTEXT.quotedCallsAddress.toLowerCase(),
      );
    });

    it('returns 400 when only sender provided without clientSalt', async () => {
      const params = `${ALL_PARAMS}&sender=${SENDER}`;
      const res = await request(app)
        .get(`/quote?${params}`)
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .expect(400);

      expect(res.body.message).to.include('sender and clientSalt');
    });

    it('returns 400 for unknown origin', async () => {
      const params = `origin=unknown&warpRoute=${WARP_ROUTE}&destination=42161&recipient=${RECIPIENT}`;
      const res = await request(app)
        .get(`/quote?${params}`)
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .expect(400);

      expect(res.body.message).to.include('Unknown origin');
    });

    it('returns 400 without origin', async () => {
      const params = `warpRoute=${WARP_ROUTE}&destination=42161&recipient=${RECIPIENT}`;
      await request(app)
        .get(`/quote?${params}`)
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .expect(400);
    });

    it('returns 400 without destination', async () => {
      const params = `origin=ethereum&warpRoute=${WARP_ROUTE}&recipient=${RECIPIENT}`;
      await request(app)
        .get(`/quote?${params}`)
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .expect(400);
    });

    it('returns 400 without warpRoute', async () => {
      const params = `origin=ethereum&destination=42161&recipient=${RECIPIENT}`;
      await request(app)
        .get(`/quote?${params}`)
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .expect(400);
    });

    it('returns 400 without recipient', async () => {
      const params = `origin=ethereum&warpRoute=${WARP_ROUTE}&destination=42161`;
      await request(app)
        .get(`/quote?${params}`)
        .set('Authorization', `Bearer ${TEST_API_KEY}`)
        .expect(400);
    });
  });
});
