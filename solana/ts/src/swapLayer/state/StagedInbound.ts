import { PublicKey } from "@solana/web3.js";

export type StagedInboundSeeds = {
    preparedFill: PublicKey;
    bump: number;
};

export type StagedInboundInfo = {
    stagedCustodyTokenBump: number;
    stagedBy: PublicKey;
    sourceChain: number;
    recipient: PublicKey;
    isNative: boolean;
};

export class StagedInbound {
    seeds: StagedInboundSeeds;
    info: StagedInboundInfo;
    recipientPayload: Buffer;

    constructor(seeds: StagedInboundSeeds, info: StagedInboundInfo, recipientPayload: Buffer) {
        this.seeds = seeds;
        this.info = info;
        this.recipientPayload = recipientPayload;
    }

    static address(programId: PublicKey, preparedFill: PublicKey) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("staged-inbound"), preparedFill.toBuffer()],
            programId,
        )[0];
    }
}
