import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export type ExecutionParams = {
    none?: {};
    evm?: {
        gasPrice: number;
        gasTokenPrice: BN;
        updateThreshold: number;
    };
};

export type RelayParams = {
    lastUpdate: number;
    baseFee: number;
    maxGasDropoff: BN;
    executionParams: ExecutionParams;
};

export class Peer {
    chain: number;
    address: Array<number>;
    relayParams: RelayParams;

    constructor(chain: number, address: Array<number>, relayParams: RelayParams) {
        this.chain = chain;
        this.address = address;
        this.relayParams = relayParams;
    }

    static address(programId: PublicKey, chain: number) {
        const encodedChain = Buffer.alloc(2);
        encodedChain.writeUInt16BE(chain);
        return PublicKey.findProgramAddressSync([Buffer.from("peer"), encodedChain], programId)[0];
    }
}
