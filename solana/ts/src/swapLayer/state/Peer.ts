import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export type ExecutionParams = {
    none?: {};
    evm?: {
        gasPrice: number;
        gasPriceMargin: number;
    };
};

export type RelayParams = {
    baseFee: number;
    nativeTokenPrice: BN;
    maxGasDropoff: number;
    gasDropoffMargin: number;
    executionParams: ExecutionParams;
};

export type PeerSeeds = {
    chain: number;
    bump: number;
};

export class Peer {
    seeds: PeerSeeds;
    address: Array<number>;
    relayParams: RelayParams;

    constructor(seeds: PeerSeeds, address: Array<number>, relayParams: RelayParams) {
        this.seeds = seeds;
        this.address = address;
        this.relayParams = relayParams;
    }

    static address(programId: PublicKey, chain: number) {
        const encodedChain = Buffer.alloc(2);
        encodedChain.writeUInt16BE(chain);
        return PublicKey.findProgramAddressSync([Buffer.from("peer"), encodedChain], programId)[0];
    }
}
