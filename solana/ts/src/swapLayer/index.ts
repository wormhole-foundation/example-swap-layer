export * from "./state";

import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { IDL, SwapLayer } from "../../../target/types/swap_layer";
import { Custodian } from "./state";

export const PROGRAM_IDS = ["AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m"] as const;

export type ProgramId = (typeof PROGRAM_IDS)[number];

export class SwapLayerProgram {
    private _programId: ProgramId;
    private _mint: PublicKey;

    program: Program<SwapLayer>;

    get ID(): PublicKey {
        return this.program.programId;
    }

    get mint(): PublicKey {
        return this._mint;
    }

    constructor(connection: Connection, programId: ProgramId, mint: PublicKey) {
        this._programId = programId;
        this._mint = mint;
        this.program = new Program(IDL as any, new PublicKey(this._programId), {
            connection,
        });
    }

    custodianAddress(): PublicKey {
        return Custodian.address(this.ID);
    }

    usdcComposite(mint?: PublicKey): { mint: PublicKey } {
        return {
            mint: mint ?? this.mint,
        };
    }

    async fetchCustodian(input?: { address: PublicKey }): Promise<Custodian> {
        const addr = input === undefined ? this.custodianAddress() : input.address;
        return this.program.account.custodian.fetch(addr);
    }

    async initializeIx(accounts: {
        owner: PublicKey;
        ownerAssistant: PublicKey;
        feeRecipient: PublicKey;
        feeUpdater: PublicKey;
        mint?: PublicKey;
    }): Promise<TransactionInstruction> {
        const { owner, ownerAssistant, feeRecipient, feeUpdater, mint } = accounts;

        return this.program.methods
            .initialize()
            .accounts({
                owner,
                custodian: this.custodianAddress(),
                ownerAssistant,
                feeRecipient,
                feeRecipientToken: splToken.getAssociatedTokenAddressSync(this.mint, feeRecipient),
                feeUpdater,
                usdc: this.usdcComposite(this.mint),
            })
            .instruction();
    }
}

export function localnet(): ProgramId {
    return "AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m";
}
