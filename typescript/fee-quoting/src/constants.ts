export const DEFAULT_PORT = 3000;
export const DEFAULT_QUOTE_EXPIRY_SECONDS = 300;

// Wildcard values matching Solidity type(T).max
export const WILDCARD_ADDRESS =
  '0xffffffffffffffffffffffffffffffffffffffff' as const;
export const WILDCARD_BYTES32 =
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as const;
export const WILDCARD_UINT256 =
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as const;
export const WILDCARD_UINT32 = 0xffffffff;

export const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000' as const;
export const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

export const EIP712_DOMAIN = {
  name: 'OffchainQuoter',
  version: '1',
} as const;

export const SIGNED_QUOTE_TYPES = {
  SignedQuote: [
    { name: 'context', type: 'bytes' },
    { name: 'data', type: 'bytes' },
    { name: 'issuedAt', type: 'uint48' },
    { name: 'expiry', type: 'uint48' },
    { name: 'salt', type: 'bytes32' },
    { name: 'submitter', type: 'address' },
  ],
} as const;
