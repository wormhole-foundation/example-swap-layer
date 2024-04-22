import { PublicKey } from "@solana/web3.js";

export class Peer {
    chain: number;
    address: Array<number>;

    constructor(chain: number, address: Array<number>) {
        this.chain = chain;
        this.address = address;
    }

    static address(programId: PublicKey, chain: number) {
        const encodedChain = Buffer.alloc(2);
        encodedChain.writeUInt16BE(chain);
        return PublicKey.findProgramAddressSync([Buffer.from("peer"), encodedChain], programId)[0];
    }
}
