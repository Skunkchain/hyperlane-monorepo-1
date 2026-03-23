import type { Logger } from 'pino';
import {
  type Address,
  type Hex,
  type LocalAccount,
  encodePacked,
  keccak256,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  EIP712_DOMAIN,
  SIGNED_QUOTE_TYPES,
  ZERO_ADDRESS,
  ZERO_BYTES32,
} from '../constants.js';
import type {
  ChainQuoteContext,
  QuoteResponse,
  SignedQuoteData,
  SubmitQuoteCommand,
} from '../types.js';

export interface QuoteServiceOptions {
  signerKey: Hex;
  quoteExpiry: number;
  chainContexts: Map<string, ChainQuoteContext>;
  logger: Logger;
}

export interface TransientQuoteParams {
  sender: Address;
  clientSalt: Hex;
}

export class QuoteService {
  private readonly account: LocalAccount;
  private readonly quoteExpiry: number;
  private readonly chainContexts: Map<string, ChainQuoteContext>;
  private readonly logger: Logger;

  constructor(options: QuoteServiceOptions) {
    this.account = privateKeyToAccount(options.signerKey);
    this.quoteExpiry = options.quoteExpiry;
    this.chainContexts = options.chainContexts;
    this.logger = options.logger;
  }

  get signerAddress(): Address {
    return this.account.address;
  }

  getChainContext(origin: string): ChainQuoteContext | undefined {
    return this.chainContexts.get(origin);
  }

  /**
   * Generate signed quotes for a warp route transfer.
   *
   * Returns SubmitQuoteCommand objects ready for QuotedCalls.execute:
   *   { quoter, quote, signature }
   *
   * When `transient` is provided (sender + clientSalt), quotes are transient:
   *   - expiry == issuedAt (auto-clears at end of tx)
   *   - salt = keccak256(sender, clientSalt) (scoped to caller)
   *   - submitter = quotedCalls address (only QuotedCalls can submit)
   *
   * Without `transient`, quotes are standing:
   *   - expiry = issuedAt + quoteTTL
   *   - salt = bytes32(0), submitter = address(0) (unrestricted)
   */
  async getQuote(
    origin: string,
    warpRouteAddress: Address,
    destination: number,
    recipient: Hex,
    transient?: TransientQuoteParams,
  ): Promise<QuoteResponse> {
    const ctx = this.chainContexts.get(origin);
    if (!ctx) {
      throw new Error(`Unknown origin chain: ${origin}`);
    }

    const quotes = await Promise.all([
      this.signWarpFeeQuote(ctx, destination, recipient, transient),
      // IGP sender is the warp route address (it dispatches the message)
      this.signIgpQuote(ctx, destination, warpRouteAddress, transient),
    ]);

    this.logger.info(
      {
        origin,
        destination,
        warpRouteAddress,
        transient: !!transient,
      },
      'Generated signed quotes',
    );

    return quotes;
  }

  private async signWarpFeeQuote(
    ctx: ChainQuoteContext,
    destination: number,
    recipient: Hex,
    transient?: TransientQuoteParams,
  ): Promise<SubmitQuoteCommand> {
    // Fee quote context (68 bytes): [destination:4][recipient:32][amount:32]
    // Amount uses wildcard (any transfer amount gets zero fee)
    const context = encodePacked(
      ['uint32', 'bytes32', 'uint256'],
      [destination, recipient, BigInt(2) ** BigInt(256) - BigInt(1)],
    );

    // Fee quote data (64 bytes): [maxFee:32][halfAmount:32]
    // Zero fee: min(0, amount * 0 / (2 * 1)) = 0
    const data = encodePacked(
      ['uint256', 'uint256'],
      [0n, 1n], // maxFee=0, halfAmount=1
    );

    const { quote, signature } = await this.signQuote(
      ctx.chainId,
      ctx.feeContractAddress,
      context,
      data,
      transient
        ? {
            salt: scopeSalt(transient.sender, transient.clientSalt),
            submitter: ctx.quotedCallsAddress,
          }
        : undefined,
    );

    return { quoter: ctx.feeContractAddress, quote, signature };
  }

  private async signIgpQuote(
    ctx: ChainQuoteContext,
    destination: number,
    sender: Address,
    transient?: TransientQuoteParams,
  ): Promise<SubmitQuoteCommand> {
    // IGP quote context (44 bytes): [feeToken:20][destination:4][sender:20]
    const context = encodePacked(
      ['address', 'uint32', 'address'],
      [ctx.feeTokenAddress, destination, sender],
    );

    // IGP quote data (32 bytes): [tokenExchangeRate:16][gasPrice:16]
    // Zero fee: gasLimit * 0 * 0 / 1e10 = 0
    const data = encodePacked(
      ['uint128', 'uint128'],
      [0n, 0n], // tokenExchangeRate=0, gasPrice=0
    );

    const { quote, signature } = await this.signQuote(
      ctx.chainId,
      ctx.igpAddress,
      context,
      data,
      transient
        ? {
            salt: scopeSalt(transient.sender, transient.clientSalt),
            submitter: ctx.quotedCallsAddress,
          }
        : undefined,
    );

    return { quoter: ctx.igpAddress, quote, signature };
  }

  private async signQuote(
    chainId: number,
    verifyingContract: Address,
    context: Hex,
    data: Hex,
    binding?: { salt: Hex; submitter: Address },
  ): Promise<{ quote: SignedQuoteData; signature: Hex }> {
    const issuedAt = Math.floor(Date.now() / 1000);
    // Transient: expiry == issuedAt; Standing: expiry = issuedAt + TTL
    const expiry = binding ? issuedAt : issuedAt + this.quoteExpiry;

    const quote: SignedQuoteData = {
      context,
      data,
      issuedAt,
      expiry,
      salt: binding?.salt ?? ZERO_BYTES32,
      submitter: binding?.submitter ?? ZERO_ADDRESS,
    };

    const signature = await this.account.signTypedData({
      domain: {
        ...EIP712_DOMAIN,
        chainId: BigInt(chainId),
        verifyingContract,
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
    });

    return { quote, signature };
  }
}

/**
 * Mirrors QuotedCalls._scopeSalt: keccak256(abi.encodePacked(sender, clientSalt))
 */
export function scopeSalt(sender: Address, clientSalt: Hex): Hex {
  return keccak256(encodePacked(['address', 'bytes32'], [sender, clientSalt]));
}
