export * from "./state";

import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { IDL, SwapLayer } from "../../../target/types/swap_layer";
import { Custodian, Peer } from "./state";
import * as tokenRouterSdk from "../../../../lib/example-liquidity-layer/solana/ts/src/tokenRouter";
import * as wormholeSdk from "@certusone/wormhole-sdk";

export const PROGRAM_IDS = ["AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m"] as const;

export type ProgramId = (typeof PROGRAM_IDS)[number];

export type AddPeerArgs = {
    chain: wormholeSdk.ChainId;
    address: Array<number>;
};
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
        return PublicKey.findProgramAddressSync([Buffer.from("custodian")], this.ID)[0];
    }

    peerAddress(chain: wormholeSdk.ChainId): PublicKey {
        return Peer.address(this.ID, chain);
    }

    usdcComposite(mint?: PublicKey): { mint: PublicKey } {
        return {
            mint: mint ?? this.mint,
        };
    }

    tmpTokenAccountKey() {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("tmp"), this.mint.toBuffer()],
            this.ID,
        )[0];
    }

    checkedCustodianComposite(addr?: PublicKey): { custodian: PublicKey } {
        return { custodian: addr ?? this.custodianAddress() };
    }

    adminComposite(
        ownerOrAssistant: PublicKey,
        custodian?: PublicKey,
    ): { ownerOrAssistant: PublicKey; custodian: { custodian: PublicKey } } {
        return { ownerOrAssistant, custodian: this.checkedCustodianComposite(custodian) };
    }

    async fetchCustodian(input?: { address: PublicKey }): Promise<Custodian> {
        const addr = input === undefined ? this.custodianAddress() : input.address;
        return this.program.account.custodian.fetch(addr);
    }

    async fetchPeer(input: wormholeSdk.ChainId | { address: PublicKey }): Promise<Peer> {
        const addr =
            typeof input == "object" && "address" in input
                ? input.address
                : this.peerAddress(input);
        return this.program.account.peer.fetch(addr);
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

    async addPeerIxx(
        accounts: {
            ownerOrAssistant: PublicKey;
            payer?: PublicKey;
            custodian?: PublicKey;
            peer?: PublicKey;
        },
        args: AddPeerArgs,
    ) {
        let { ownerOrAssistant, payer, custodian, peer } = accounts;
        payer ??= ownerOrAssistant;
        peer ??= this.peerAddress(args.chain);

        return this.program.methods
            .addPeer(args)
            .accounts({
                payer,
                admin: this.adminComposite(ownerOrAssistant, custodian),
                peer,
            })
            .instruction();
    }

    async completeTransferRelayIx(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            tokenRouterCustody: PublicKey;
            tokenRouterProgram: PublicKey;
            recipient: PublicKey;
            peer?: PublicKey;
            beneficiary?: PublicKey;
            recipientTokenAccount?: PublicKey;
            feeRecipientToken?: PublicKey;
        },
        fromChain?: wormholeSdk.ChainId,
    ) {
        let {
            payer,
            beneficiary,
            preparedFill,
            tokenRouterCustody,
            tokenRouterProgram,
            peer,
            recipient,
            recipientTokenAccount,
            feeRecipientToken,
        } = accounts;

        if (fromChain === undefined && peer === undefined) {
            throw new Error("from_chain or peer must be provided");
        }

        peer = peer ?? this.peerAddress(fromChain!);
        beneficiary ??= payer;
        recipientTokenAccount ??= splToken.getAssociatedTokenAddressSync(this.mint, recipient);

        if (feeRecipientToken === undefined) {
            feeRecipientToken = await this.fetchCustodian().then((c) => c.feeRecipientToken);
        }

        return this.program.methods
            .completeTransferRelay()
            .accounts({
                payer,
                custodian: this.checkedCustodianComposite(),
                tmpTokenAccount: this.tmpTokenAccountKey(),
                recipient,
                recipientTokenAccount,
                usdc: this.usdcComposite(this.mint),
                beneficiary,
                peer,
                preparedFill,
                feeRecipientToken,
                tokenRouterCustody,
                tokenRouterProgram,
            })
            .instruction();
    }

    async completeTransferDirectIx(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            tokenRouterCustody: PublicKey;
            tokenRouterProgram: PublicKey;
            peer?: PublicKey;
            recipient?: PublicKey;
            beneficiary?: PublicKey;
            recipientTokenAccount?: PublicKey;
        },
        fromChain?: wormholeSdk.ChainId,
    ) {
        let {
            payer,
            beneficiary,
            preparedFill,
            tokenRouterCustody,
            tokenRouterProgram,
            peer,
            recipient,
            recipientTokenAccount,
        } = accounts;

        if (fromChain === undefined && peer === undefined) {
            throw new Error("from_chain or peer must be provided");
        }

        peer = peer ?? this.peerAddress(fromChain!);

        beneficiary ??= payer;
        recipient ??= payer;
        recipientTokenAccount ??= splToken.getAssociatedTokenAddressSync(this.mint, recipient);

        return this.program.methods
            .completeTransferDirect()
            .accounts({
                payer,
                custodian: this.checkedCustodianComposite(),
                beneficiary,
                recipient,
                recipientTokenAccount,
                usdc: this.usdcComposite(this.mint),
                preparedFill,
                peer,
                tokenRouterCustody,
                tokenRouterProgram,
            })
            .instruction();
    }
}

export function localnet(): ProgramId {
    return "AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m";
}
