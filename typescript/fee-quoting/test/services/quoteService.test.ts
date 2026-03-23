import { expect } from 'chai';
import { pino } from 'pino';
import { type Address, type Hex, encodePacked, verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  EIP712_DOMAIN,
  SIGNED_QUOTE_TYPES,
  ZERO_ADDRESS,
  ZERO_BYTES32,
} from '../../src/constants.js';
import {
  QuoteService,
  type QuoteServiceOptions,
  scopeSalt,
} from '../../src/services/quoteService.js';
import type { ChainQuoteContext } from '../../src/types.js';

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);

const QUOTED_CALLS_ADDRESS =
  '0x4444444444444444444444444444444444444444' as Address;
const FEE_CONTRACT = '0x1111111111111111111111111111111111111111' as Address;
const IGP_ADDRESS = '0x2222222222222222222222222222222222222222' as Address;

const TEST_CHAIN_CONTEXT: ChainQuoteContext = {
  chainId: 1,
  domainId: 1,
  chainName: 'ethereum',
  feeContractAddress: FEE_CONTRACT,
  igpAddress: IGP_ADDRESS,
  feeTokenAddress: '0x3333333333333333333333333333333333333333' as Address,
  quotedCallsAddress: QUOTED_CALLS_ADDRESS,
};

const WARP_ROUTE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const RECIPIENT =
  '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex;
const DESTINATION = 42161;

function createTestService(
  overrides?: Partial<QuoteServiceOptions>,
): QuoteService {
  const chainContexts = new Map<string, ChainQuoteContext>();
  chainContexts.set('ethereum', TEST_CHAIN_CONTEXT);

  return new QuoteService({
    signerKey: TEST_PRIVATE_KEY,
    quoteExpiry: 300,
    chainContexts,
    logger: pino({ level: 'silent' }),
    ...overrides,
  });
}

describe('QuoteService', () => {
  let service: QuoteService;

  beforeEach(() => {
    service = createTestService();
  });

  describe('signerAddress', () => {
    it('returns the correct signer address', () => {
      expect(service.signerAddress.toLowerCase()).to.equal(
        TEST_ACCOUNT.address.toLowerCase(),
      );
    });
  });

  describe('standing quotes (no sender/clientSalt)', () => {
    it('returns array of SubmitQuoteCommands', async () => {
      const result = await service.getQuote(
        'ethereum',
        WARP_ROUTE,
        DESTINATION,
        RECIPIENT,
      );

      expect(result).to.be.an('array').with.lengthOf(2);
      // [0] = warp fee quote, [1] = IGP quote
      expect(result[0].quoter.toLowerCase()).to.equal(
        FEE_CONTRACT.toLowerCase(),
      );
      expect(result[1].quoter.toLowerCase()).to.equal(
        IGP_ADDRESS.toLowerCase(),
      );
    });

    it('warp fee quote has zero maxFee', async () => {
      const result = await service.getQuote(
        'ethereum',
        WARP_ROUTE,
        DESTINATION,
        RECIPIENT,
      );

      const expectedData = encodePacked(['uint256', 'uint256'], [0n, 1n]);
      expect(result[0].quote.data).to.equal(expectedData);
    });

    it('IGP sender is the warp route address', async () => {
      const result = await service.getQuote(
        'ethereum',
        WARP_ROUTE,
        DESTINATION,
        RECIPIENT,
      );

      const expectedContext = encodePacked(
        ['address', 'uint32', 'address'],
        [TEST_CHAIN_CONTEXT.feeTokenAddress, DESTINATION, WARP_ROUTE],
      );
      expect(result[1].quote.context).to.equal(expectedContext);
    });

    it('standing quote has expiry > issuedAt', async () => {
      const result = await service.getQuote(
        'ethereum',
        WARP_ROUTE,
        DESTINATION,
        RECIPIENT,
      );

      expect(result[0].quote.expiry).to.be.greaterThan(
        result[0].quote.issuedAt,
      );
    });

    it('uses zero salt and zero submitter', async () => {
      const result = await service.getQuote(
        'ethereum',
        WARP_ROUTE,
        DESTINATION,
        RECIPIENT,
      );

      expect(result[0].quote.salt).to.equal(ZERO_BYTES32);
      expect(result[0].quote.submitter).to.equal(ZERO_ADDRESS);
    });

    it('warp fee signature is valid EIP-712', async () => {
      const result = await service.getQuote(
        'ethereum',
        WARP_ROUTE,
        DESTINATION,
        RECIPIENT,
      );
      const { quote, signature } = result[0];

      const valid = await verifyTypedData({
        address: TEST_ACCOUNT.address,
        domain: {
          ...EIP712_DOMAIN,
          chainId: BigInt(TEST_CHAIN_CONTEXT.chainId),
          verifyingContract: FEE_CONTRACT,
        },
        types: SIGNED_QUOTE_TYPES,
        primaryType: 'SignedQuote',
        message: {
          context: quote.context,
          data: quote.data,
          issuedAt: quote.issuedAt,
          expiry: quote.expiry,
          salt: quote.salt,
          submitter: quote.submitter,
        },
        signature,
      });

      expect(valid).to.be.true;
    });
  });

  describe('transient quotes (with sender/clientSalt)', () => {
    const SENDER = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
    const CLIENT_SALT = ZERO_BYTES32;

    it('expiry equals issuedAt (transient)', async () => {
      const result = await service.getQuote(
        'ethereum',
        WARP_ROUTE,
        DESTINATION,
        RECIPIENT,
        { sender: SENDER, clientSalt: CLIENT_SALT },
      );

      expect(result[0].quote.expiry).to.equal(result[0].quote.issuedAt);
      expect(result[1].quote.expiry).to.equal(result[1].quote.issuedAt);
    });

    it('salt is keccak256(sender, clientSalt)', async () => {
      const result = await service.getQuote(
        'ethereum',
        WARP_ROUTE,
        DESTINATION,
        RECIPIENT,
        { sender: SENDER, clientSalt: CLIENT_SALT },
      );

      const expectedSalt = scopeSalt(SENDER, CLIENT_SALT);
      expect(result[0].quote.salt).to.equal(expectedSalt);
      expect(result[1].quote.salt).to.equal(expectedSalt);
    });

    it('submitter is the QuotedCalls address', async () => {
      const result = await service.getQuote(
        'ethereum',
        WARP_ROUTE,
        DESTINATION,
        RECIPIENT,
        { sender: SENDER, clientSalt: CLIENT_SALT },
      );

      expect(result[0].quote.submitter).to.equal(QUOTED_CALLS_ADDRESS);
      expect(result[1].quote.submitter).to.equal(QUOTED_CALLS_ADDRESS);
    });

    it('transient signature is valid EIP-712', async () => {
      const result = await service.getQuote(
        'ethereum',
        WARP_ROUTE,
        DESTINATION,
        RECIPIENT,
        { sender: SENDER, clientSalt: CLIENT_SALT },
      );
      const { quote, signature } = result[0];

      const valid = await verifyTypedData({
        address: TEST_ACCOUNT.address,
        domain: {
          ...EIP712_DOMAIN,
          chainId: BigInt(TEST_CHAIN_CONTEXT.chainId),
          verifyingContract: FEE_CONTRACT,
        },
        types: SIGNED_QUOTE_TYPES,
        primaryType: 'SignedQuote',
        message: {
          context: quote.context,
          data: quote.data,
          issuedAt: quote.issuedAt,
          expiry: quote.expiry,
          salt: quote.salt,
          submitter: quote.submitter,
        },
        signature,
      });

      expect(valid).to.be.true;
    });
  });

  describe('scopeSalt', () => {
    it('produces deterministic output', () => {
      const sender = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
      const salt1 = scopeSalt(sender, ZERO_BYTES32);
      const salt2 = scopeSalt(sender, ZERO_BYTES32);
      expect(salt1).to.equal(salt2);
    });

    it('differs for different senders', () => {
      const s1 = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
      const s2 = '0xDDdDddDdDdddDDddDDddDDDDdDdDDdDDdDDDDDDd' as Address;
      expect(scopeSalt(s1, ZERO_BYTES32)).to.not.equal(
        scopeSalt(s2, ZERO_BYTES32),
      );
    });
  });

  it('throws for unknown origin', async () => {
    try {
      await service.getQuote('unknown', WARP_ROUTE, DESTINATION, RECIPIENT);
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as Error).message).to.include('Unknown origin chain');
    }
  });
});
