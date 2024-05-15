import { PublicKey } from "@solana/web3.js";

export type StagedTransferSeeds = {
    preparedFill: PublicKey;
    bump: number;
};

export type StagedTransferInfo = {
    stagedCustodyTokenBump: number;
    stagedBy: PublicKey;
    sourceChain: number;
    recipient: PublicKey;
    isNative: boolean;
};

export class StagedTransfer {
    seeds: StagedTransferSeeds;
    info: StagedTransferInfo;
    recipientPayload: Buffer;

    constructor(seeds: StagedTransferSeeds, info: StagedTransferInfo, recipientPayload: Buffer) {
        this.seeds = seeds;
        this.info = info;
        this.recipientPayload = recipientPayload;
    }

    static address(programId: PublicKey, preparedFill: PublicKey) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("staged"), preparedFill.toBuffer()],
            programId,
        )[0];
    }
}
