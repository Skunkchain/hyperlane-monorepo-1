import type { Address, Hex } from 'viem';

export interface SignedQuoteData {
  context: Hex;
  data: Hex;
  issuedAt: number;
  expiry: number;
  salt: Hex;
  submitter: Address;
}

/** SUBMIT_QUOTE command parameters for QuotedCalls.execute */
export interface SubmitQuoteCommand {
  quoter: Address;
  quote: SignedQuoteData;
  signature: Hex;
}

export type QuoteResponse = SubmitQuoteCommand[];

export interface ChainQuoteContext {
  chainId: number;
  domainId: number;
  chainName: string;
  /** Fee contract address (OffchainQuotedLinearFee) — verifyingContract for warp fee EIP-712 */
  feeContractAddress: Address;
  igpAddress: Address;
  feeTokenAddress: Address;
  quotedCallsAddress: Address;
}
