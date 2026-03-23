import type { Address, Hex } from 'viem';

import type { QuoteResponse } from './types.js';

export interface FeeQuotingClientOptions {
  baseUrl: string;
  apiKey: string;
}

export interface QuoteParams {
  origin: string;
  warpRoute: Address;
  destination: number;
  recipient: Hex;
  /** Provide sender + clientSalt for transient quotes (QuotedCalls.execute) */
  sender?: Address;
  clientSalt?: Hex;
}

export class FeeQuotingClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: FeeQuotingClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
  }

  async getQuote(params: QuoteParams): Promise<QuoteResponse> {
    const query = new URLSearchParams({
      origin: params.origin,
      warpRoute: params.warpRoute,
      destination: String(params.destination),
      recipient: params.recipient,
    });

    if (params.sender && params.clientSalt) {
      query.set('sender', params.sender);
      query.set('clientSalt', params.clientSalt);
    }

    const res = await fetch(`${this.baseUrl}/quote?${query}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `Fee quoting request failed (${res.status}): ${(body as Record<string, string>).message ?? res.statusText}`,
      );
    }

    return res.json() as Promise<QuoteResponse>;
  }
}
