import type {
  Address,
  Instruction,
  ReadonlyUint8Array,
  TransactionSigner,
} from '@solana/kit';

import { concatBytes, u8, u32le, vec } from '../codecs/binary.js';
import {
  encodeH256,
  encodeRemoteRouterConfig,
  type H256,
  type RemoteRouterConfig,
} from '../codecs/shared.js';
import { SYSTEM_PROGRAM_ADDRESS } from '../constants.js';
import {
  deriveCrossCollateralDispatchAuthorityPda,
  deriveCrossCollateralStatePda,
  deriveHyperlaneTokenPda,
  deriveMailboxDispatchAuthorityPda,
} from '../pda.js';
import { encodeTokenInit, type TokenInitInstructionData } from './token.js';
import {
  buildInstruction,
  type InstructionAccountMeta,
  readonlyAccount,
  writableAccount,
  writableSigner,
  writableSignerAddress,
} from './utils.js';

const CC_INSTRUCTION_DISCRIMINATOR = new Uint8Array([2, 2, 2, 2, 2, 2, 2, 2]);

export enum CrossCollateralInstructionKind {
  Init = 0,
  SetCrossCollateralRouters = 1,
  TransferRemoteTo = 2,
  HandleLocal = 3,
  HandleLocalAccountMetas = 4,
}

export type CrossCollateralRouterUpdate =
  | { kind: 'add'; domain: number; router: H256 }
  | { kind: 'remove'; config: RemoteRouterConfig };

function encodeCrossCollateralRouterUpdate(
  update: CrossCollateralRouterUpdate,
): ReadonlyUint8Array {
  if (update.kind === 'add') {
    return concatBytes(u8(0), u32le(update.domain), encodeH256(update.router));
  }

  return concatBytes(u8(1), encodeRemoteRouterConfig(update.config));
}

function encodeCrossCollateralInit(
  value: TokenInitInstructionData,
): ReadonlyUint8Array {
  return concatBytes(
    CC_INSTRUCTION_DISCRIMINATOR,
    u8(CrossCollateralInstructionKind.Init),
    encodeTokenInit(value),
  );
}

export async function getCrossCollateralInitInstruction(
  programAddress: Address,
  payer: TransactionSigner,
  init: TokenInitInstructionData,
  pluginAccounts: InstructionAccountMeta[],
  mailboxOutboxPda: Address,
): Promise<Instruction> {
  const { address: tokenPda } = await deriveHyperlaneTokenPda(programAddress);
  const { address: dispatchAuthority } =
    await deriveMailboxDispatchAuthorityPda(programAddress);
  const { address: ccStatePda } =
    await deriveCrossCollateralStatePda(programAddress);
  const { address: ccDispatchAuthority } =
    await deriveCrossCollateralDispatchAuthorityPda(programAddress);

  return buildInstruction(
    programAddress,
    [
      readonlyAccount(SYSTEM_PROGRAM_ADDRESS),
      writableAccount(tokenPda),
      writableAccount(dispatchAuthority),
      writableSigner(payer),
      ...pluginAccounts,
      writableAccount(ccStatePda),
      writableAccount(ccDispatchAuthority),
      readonlyAccount(mailboxOutboxPda),
    ],
    encodeCrossCollateralInit(init),
  );
}

export async function getSetCrossCollateralRoutersInstruction(
  programAddress: Address,
  owner: Address,
  updates: CrossCollateralRouterUpdate[],
): Promise<Instruction> {
  const { address: ccStatePda } =
    await deriveCrossCollateralStatePda(programAddress);
  const { address: tokenPda } = await deriveHyperlaneTokenPda(programAddress);

  return buildInstruction(
    programAddress,
    [
      readonlyAccount(SYSTEM_PROGRAM_ADDRESS),
      writableAccount(ccStatePda),
      readonlyAccount(tokenPda),
      writableSignerAddress(owner),
    ],
    concatBytes(
      CC_INSTRUCTION_DISCRIMINATOR,
      u8(CrossCollateralInstructionKind.SetCrossCollateralRouters),
      vec(updates, encodeCrossCollateralRouterUpdate),
    ),
  );
}
