export * from "./state";
export * from "./relayerFees";

import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import IDL from "../../../target/idl/swap_layer.json";
import { SwapLayer } from "../../../target/types/swap_layer";
import { Custodian, RelayParams, Peer } from "./state";
import * as wormholeSdk from "@certusone/wormhole-sdk";

export const PROGRAM_IDS = ["AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m"] as const;

export type ProgramId = (typeof PROGRAM_IDS)[number];

export type AddPeerArgs = {
    chain: wormholeSdk.ChainId;
    address: Array<number>;
    relayParams: RelayParams;
};

export type RelayOptions = {
    gasDropoff: number;
    maxRelayerFee: BN;
};

export type InitiateTransferArgs = {
    amountIn: BN;
    targetChain: number;
    relayOptions: RelayOptions | null;
    recipient: Array<number>;
};

export type UpdateRelayParametersArgs = {
    chain: wormholeSdk.ChainId;
    relayParams: RelayParams;
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
        this.program = new Program(
            { ...(IDL as any), address: this._programId },
            {
                connection,
            },
        );
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

    completeTokenAccountKey(preparedFill: PublicKey) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("complete"), preparedFill.toBuffer()],
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

    adminMutComposite(
        ownerOrAssistant: PublicKey,
        custodian?: PublicKey,
    ): { ownerOrAssistant: PublicKey; custodian: PublicKey } {
        return { ownerOrAssistant, custodian: custodian ?? this.custodianAddress() };
    }

    ownerOnlyComposite(
        owner: PublicKey,
        custodian?: PublicKey,
    ): { owner: PublicKey; custodian: { custodian: PublicKey } } {
        return { owner, custodian: this.checkedCustodianComposite(custodian) };
    }

    ownerOnlyMutComposite(
        owner: PublicKey,
        custodian?: PublicKey,
    ): { owner: PublicKey; custodian: PublicKey } {
        return { owner, custodian: custodian ?? this.custodianAddress() };
    }

    feeUpdaterComposite(
        feeUpdater: PublicKey,
        custodian?: PublicKey,
    ): { feeUpdater: PublicKey; custodian: { custodian: PublicKey } } {
        return { feeUpdater, custodian: this.checkedCustodianComposite(custodian) };
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
                systemProgram: SystemProgram.programId,
            })
            .instruction();
    }

    async addPeerIx(
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

        return (
            this.program.methods
                // @ts-ignore
                .addPeer(args)
                .accounts({
                    payer,
                    admin: this.adminComposite(ownerOrAssistant, custodian),
                    peer,
                    systemProgram: SystemProgram.programId,
                })
                .instruction()
        );
    }

    async updatePeerIx(
        accounts: {
            owner: PublicKey;
            custodian?: PublicKey;
            peer?: PublicKey;
        },
        args: AddPeerArgs,
    ) {
        let { owner, custodian, peer } = accounts;
        peer ??= this.peerAddress(args.chain);

        return (
            this.program.methods
                // @ts-ignore
                .updatePeer(args)
                .accounts({
                    admin: this.ownerOnlyComposite(owner, custodian),
                    peer,
                })
                .instruction()
        );
    }

    async submitOwnershipTransferIx(accounts: {
        owner: PublicKey;
        newOwner: PublicKey;
        custodian?: PublicKey;
    }): Promise<TransactionInstruction> {
        const { owner, newOwner, custodian } = accounts;
        return this.program.methods
            .submitOwnershipTransferRequest()
            .accounts({
                admin: this.ownerOnlyMutComposite(owner, custodian),
                newOwner,
            })
            .instruction();
    }

    async confirmOwnershipTransferIx(accounts: {
        pendingOwner: PublicKey;
        custodian?: PublicKey;
    }): Promise<TransactionInstruction> {
        const { pendingOwner } = accounts;
        let { custodian } = accounts;
        custodian ??= this.custodianAddress();
        return this.program.methods
            .confirmOwnershipTransferRequest()
            .accounts({ pendingOwner, custodian })
            .instruction();
    }

    async cancelOwnershipTransferIx(accounts: {
        owner: PublicKey;
        custodian?: PublicKey;
    }): Promise<TransactionInstruction> {
        const { owner, custodian } = accounts;
        return this.program.methods
            .cancelOwnershipTransferRequest()
            .accounts({
                admin: this.ownerOnlyMutComposite(owner, custodian),
            })
            .instruction();
    }

    async updateOwnerAssistantIx(accounts: {
        owner: PublicKey;
        newOwnerAssistant: PublicKey;
        custodian?: PublicKey;
    }) {
        const { owner, newOwnerAssistant, custodian } = accounts;
        return this.program.methods
            .updateOwnerAssistant()
            .accounts({
                admin: this.ownerOnlyMutComposite(owner, custodian),
                newOwnerAssistant,
            })
            .instruction();
    }

    async updateFeeUpdaterIx(accounts: {
        ownerOrAssistant: PublicKey;
        newFeeUpdater: PublicKey;
        custodian?: PublicKey;
    }) {
        const { ownerOrAssistant, newFeeUpdater, custodian } = accounts;
        return this.program.methods
            .updateFeeUpdater()
            .accounts({
                admin: this.adminMutComposite(ownerOrAssistant, custodian),
                newFeeUpdater,
            })
            .instruction();
    }

    async updateRelayParamsIx(
        accounts: { feeUpdater: PublicKey; custodian?: PublicKey; peer?: PublicKey },
        args: UpdateRelayParametersArgs,
    ) {
        let { feeUpdater, custodian, peer } = accounts;

        peer ??= this.peerAddress(args.chain);

        return (
            this.program.methods
                // @ts-ignore
                .updateRelayParameters(args)
                .accounts({
                    feeUpdater: this.feeUpdaterComposite(feeUpdater, custodian),
                    peer,
                })
                .instruction()
        );
    }

    async updateFeeRecipientIx(accounts: {
        ownerOrAssistant: PublicKey;
        newFeeRecipient: PublicKey;
        custodian?: PublicKey;
    }): Promise<TransactionInstruction> {
        const { ownerOrAssistant, newFeeRecipient, custodian } = accounts;
        return this.program.methods
            .updateFeeRecipient()
            .accounts({
                admin: this.adminMutComposite(ownerOrAssistant, custodian),
                newFeeRecipient,
                newFeeRecipientToken: splToken.getAssociatedTokenAddressSync(
                    this.mint,
                    newFeeRecipient,
                ),
            })
            .instruction();
    }

    async initiateTransferIx(
        accounts: {
            payer: PublicKey;
            preparedOrder: PublicKey; // Just generate a keypair.
            tokenRouterCustodian: PublicKey;
            tokenRouterProgram: PublicKey;
            preparedCustodyToken: PublicKey;
            payerToken?: PublicKey;
            peer?: PublicKey;
        },
        args: InitiateTransferArgs,
    ) {
        let {
            payer,
            preparedOrder,
            tokenRouterCustodian,
            tokenRouterProgram,
            preparedCustodyToken,
            payerToken,
            peer,
        } = accounts;

        payerToken ??= splToken.getAssociatedTokenAddressSync(this.mint, payer);
        peer ??= this.peerAddress(args.targetChain as wormholeSdk.ChainId);

        return this.program.methods
            .initiateTransfer(args)
            .accounts({
                payer,
                payerToken,
                usdc: this.usdcComposite(this.mint),
                peer,
                tokenRouterCustodian,
                preparedOrder,
                preparedCustodyToken,
                tokenRouterProgram,
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
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

        // Need the undefined check to satisfy the type checker.
        feeRecipientToken ??= await this.fetchCustodian().then((c) => c.feeRecipientToken);
        if (feeRecipientToken === undefined) {
            throw new Error("fee recipient token account not found");
        }

        return this.program.methods
            .completeTransferRelay()
            .accounts({
                payer,
                custodian: this.checkedCustodianComposite(),
                completeTokenAccount: this.completeTokenAccountKey(preparedFill),
                recipient,
                recipientTokenAccount,
                usdc: this.usdcComposite(this.mint),
                beneficiary,
                peer,
                preparedFill,
                feeRecipientToken,
                tokenRouterCustody,
                tokenRouterProgram,
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
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
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .instruction();
    }
}

export function localnet(): ProgramId {
    return "AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m";
}
