export * from "./layouts";

import * as jupAg from "@jup-ag/api";
import * as splToken from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { decodeSharedAccountsRouteArgs, encodeSharedAccountsRouteArgs } from "./layouts";

export const JUPITER_V6_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

export function toTransactionInstruction(instruction: jupAg.Instruction): TransactionInstruction {
    return {
        programId: new PublicKey(instruction.programId),
        keys: instruction.accounts.map((key: any) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
        })),
        data: Buffer.from(instruction.data, "base64"),
    };
}

export type ModifySharedAccountsRouteOpts = {
    inAmount: bigint;
    quotedOutAmount?: bigint;
    slippageBps?: number;
    cpi?: boolean;
};

export type ModifiedSharedAccountsRoute = {
    instruction: TransactionInstruction;
    sourceToken: PublicKey;
    destinationToken: PublicKey;
    sourceMint: PublicKey;
    destinationMint: PublicKey;
    minAmountOut: bigint;
};

export function modifySharedAccountsRouteInstruction(
    instruction: jupAg.Instruction,
    tokenOwner: PublicKey,
    opts: ModifySharedAccountsRouteOpts,
): ModifiedSharedAccountsRoute {
    const { inAmount } = opts;
    let { quotedOutAmount, slippageBps, cpi } = opts;
    quotedOutAmount ??= inAmount;
    slippageBps ??= 0;
    cpi ??= false;

    const ix = toTransactionInstruction(instruction);

    // Adjust accounts.
    const userTransferAuthorityIdx = 2;
    ix.keys[userTransferAuthorityIdx].pubkey = tokenOwner;
    ix.keys[userTransferAuthorityIdx].isSigner = !cpi;

    const sourceMint = ix.keys[7].pubkey;
    const destinationMint = ix.keys[8].pubkey;

    const sourceToken = splToken.getAssociatedTokenAddressSync(
        sourceMint,
        tokenOwner,
        true, // allowOwnerOffCurve
    );
    ix.keys[3].pubkey = sourceToken;

    const destinationToken = splToken.getAssociatedTokenAddressSync(
        destinationMint,
        tokenOwner,
        true, // allowOwnerOffCurve
    );
    ix.keys[6].pubkey = destinationToken;

    // Deserialize to modify args.
    const args = decodeSharedAccountsRouteArgs(ix.data) as any;
    args.inAmount = inAmount;
    args.quotedOutAmount = quotedOutAmount;
    args.slippageBps = slippageBps;

    // Serialize again.
    ix.data = encodeSharedAccountsRouteArgs(args);

    const minAmountOut = (quotedOutAmount * BigInt(10000 - slippageBps)) / BigInt(10000);

    return {
        instruction: ix,
        sourceToken,
        destinationToken,
        sourceMint,
        destinationMint,
        minAmountOut,
    };
}

export function eventAuthorityAddress(programId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], programId)[0];
}

export function programAuthorityAddress(authorityId: number) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("authority"), Buffer.from([authorityId])],
        JUPITER_V6_PROGRAM_ID,
    )[0];
}
