export * from "./messages";
export * from "./relayerFees";
export * from "./state";

import * as wormholeSdk from "@certusone/wormhole-sdk";
import { BN, Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import * as tokenRouterSdk from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter";
import IDL from "../../../target/idl/swap_layer.json";
import { SwapLayer } from "../../../target/types/swap_layer";
import { Custodian, Peer, RelayParams } from "./state";

export const PROGRAM_IDS = ["SwapLayer1111111111111111111111111111111111"] as const;

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

type CheckedCustodianComposite = {
    custodian: PublicKey;
};

type RegisteredPeerComposite = { peer: PublicKey };

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

    checkedCustodianComposite(addr?: PublicKey): CheckedCustodianComposite {
        return { custodian: addr ?? this.custodianAddress() };
    }

    adminComposite(
        ownerOrAssistant: PublicKey,
        custodian?: PublicKey,
    ): { ownerOrAssistant: PublicKey; custodian: CheckedCustodianComposite } {
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
    ): { owner: PublicKey; custodian: CheckedCustodianComposite } {
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
    ): { feeUpdater: PublicKey; custodian: CheckedCustodianComposite } {
        return { feeUpdater, custodian: this.checkedCustodianComposite(custodian) };
    }

    registeredPeerComposite(chain: wormholeSdk.ChainId): RegisteredPeerComposite {
        return { peer: this.peerAddress(chain) };
    }

    async consumeSwapLayerFillComposite(
        accounts: {
            preparedFill: PublicKey;
            beneficiary: PublicKey;
            associatedPeer?: PublicKey;
        },
        opts: { sourceChain?: wormholeSdk.ChainId } = {},
    ): Promise<{
        custodian: CheckedCustodianComposite;
        fill: PublicKey;
        fillCustodyToken: PublicKey;
        associatedPeer: RegisteredPeerComposite;
        beneficiary: PublicKey;
        tokenRouterProgram: PublicKey;
    }> {
        const { preparedFill, beneficiary } = accounts;

        let { associatedPeer: peer } = accounts;
        let { sourceChain } = opts;

        const tokenRouter = this.tokenRouterProgram();
        if (sourceChain === undefined) {
            const { info } = await tokenRouter.fetchPreparedFill(preparedFill);
            // @ts-ignore: This is a real chain ID.
            sourceChain = info.sourceChain;
        }

        peer ??= this.peerAddress(sourceChain);

        return {
            custodian: this.checkedCustodianComposite(),
            fill: preparedFill,
            fillCustodyToken: tokenRouter.preparedCustodyTokenAddress(preparedFill),
            associatedPeer: { peer },
            beneficiary,
            tokenRouterProgram: tokenRouter.ID,
        };
    }

    swapAuthorityAddress(preparedFill: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("swap-authority"), preparedFill.toBuffer()],
            this.ID,
        )[0];
    }

    swapComposite(accounts: {
        preparedFill: PublicKey;
        sourceMint: PublicKey;
        destinationMint: PublicKey;
    }) {
        const { preparedFill, sourceMint, destinationMint } = accounts;

        const authority = this.swapAuthorityAddress(preparedFill);
        return {
            authority,
            srcSwapToken: splToken.getAssociatedTokenAddressSync(sourceMint, authority, true),
            dstSwapToken: splToken.getAssociatedTokenAddressSync(destinationMint, authority, true),
        };
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
            preparedOrder: PublicKey; // Just generate a keypair
            payerToken?: PublicKey;
            peer?: PublicKey;
        },
        args: InitiateTransferArgs,
    ) {
        let { payer, preparedOrder, payerToken, peer } = accounts;

        payerToken ??= splToken.getAssociatedTokenAddressSync(this.mint, payer);
        peer ??= this.peerAddress(args.targetChain as wormholeSdk.ChainId);

        const tokenRouter = this.tokenRouterProgram();

        return this.program.methods
            .initiateTransfer(args)
            .accounts({
                payer,
                payerToken,
                usdc: this.usdcComposite(this.mint),
                peer,
                tokenRouterCustodian: tokenRouter.custodianAddress(),
                preparedOrder,
                preparedCustodyToken: tokenRouter.preparedCustodyTokenAddress(preparedOrder),
                tokenRouterProgram: tokenRouter.ID,
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .instruction();
    }

    async completeTransferRelayIx(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            recipient: PublicKey;
            peer?: PublicKey;
            beneficiary?: PublicKey;
            recipientTokenAccount?: PublicKey;
            feeRecipientToken?: PublicKey;
        },
        sourceChain?: wormholeSdk.ChainId,
    ) {
        let {
            payer,
            beneficiary,
            preparedFill,
            peer,
            recipient,
            recipientTokenAccount,
            feeRecipientToken,
        } = accounts;

        beneficiary ??= payer;
        recipientTokenAccount ??= splToken.getAssociatedTokenAddressSync(this.mint, recipient);

        // Need the undefined check to satisfy the type checker.
        feeRecipientToken ??= await this.fetchCustodian().then((c) => c.feeRecipientToken);
        if (feeRecipientToken === undefined) {
            throw new Error("fee recipient token account not found");
        }

        const tokenRouter = this.tokenRouterProgram();

        return this.program.methods
            .completeTransferRelay()
            .accounts({
                payer,
                consumeSwapLayerFill: await this.consumeSwapLayerFillComposite(
                    {
                        preparedFill,
                        beneficiary,
                        associatedPeer: peer,
                    },
                    { sourceChain },
                ),
                completeTokenAccount: this.completeTokenAccountKey(preparedFill),
                recipient,
                recipientTokenAccount,
                usdc: this.usdcComposite(this.mint),
                feeRecipientToken,
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .instruction();
    }

    async completeTransferDirectIx(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            peer?: PublicKey;
            recipient?: PublicKey;
            beneficiary?: PublicKey;
            recipientTokenAccount?: PublicKey;
        },
        sourceChain?: wormholeSdk.ChainId,
    ) {
        let { payer, beneficiary, preparedFill, peer, recipient, recipientTokenAccount } = accounts;

        beneficiary ??= payer;
        recipient ??= payer;
        recipientTokenAccount ??= splToken.getAssociatedTokenAddressSync(this.mint, recipient);

        const tokenRouter = this.tokenRouterProgram();

        return this.program.methods
            .completeTransferDirect()
            .accounts({
                consumeSwapLayerFill: await this.consumeSwapLayerFillComposite(
                    {
                        preparedFill,
                        beneficiary,
                        associatedPeer: peer,
                    },
                    { sourceChain },
                ),
                recipient,
                recipientTokenAccount,
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
            })
            .instruction();
    }

    // async completeSwapDirectIx(
    //     accounts: { payer: PublicKey; preparedFill: PublicKey; beneficiary?: PublicKey },
    //     args: {
    //         innerIx: TransactionInstruction;
    //     },
    // ): Promise<TransactionInstruction> {
    //     const { payer, preparedFill } = accounts;
    //     const { innerIx } = args;

    //     let { beneficiary } = accounts;
    //     beneficiary ??= payer;

    //     const swapAuthority =

    //     return this.program.methods
    //         .completeSwap(innerIx.data)
    //         .accounts({
    //             payer: payer,
    //             consumeSwapLayerFill: await this.consumeSwapLayerFillComposite({
    //                 preparedFill,
    //                 beneficiary,
    //             }),
    //             swapAuthority,
    //             srcSwapToken: splToken.getAssociatedTokenAddressSync(
    //                 swapLayer.mint,
    //                 swapAuthority,
    //                 true, // allowOwnerOffCurve
    //             ),
    //             dstSwapToken: splToken.getAssociatedTokenAddressSync(
    //                 USDT_MINT_ADDRESS,
    //                 swapAuthority,
    //                 true, // allowOwnerOffCurve
    //             ),
    //             usdc: swapLayer.usdcComposite(),
    //             dstMint: USDT_MINT_ADDRESS,
    //             recipientToken: splToken.getAssociatedTokenAddressSync(
    //                 USDT_MINT_ADDRESS,
    //                 recipient.publicKey,
    //             ),
    //             recipient: recipient.publicKey,
    //             associatedTokenProgram: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
    //             tokenProgram: splToken.TOKEN_PROGRAM_ID,
    //             systemProgram: SystemProgram.programId,
    //         })
    //         .remainingAccounts(innerIx.keys)
    //         .instruction();
    // }

    tokenRouterProgram(): tokenRouterSdk.TokenRouterProgram {
        switch (this._programId) {
            case localnet(): {
                return new tokenRouterSdk.TokenRouterProgram(
                    this.program.provider.connection,
                    tokenRouterSdk.localnet(),
                    this.mint,
                );
            }
            default: {
                throw new Error("unsupported network");
            }
        }
    }
}

export function localnet(): ProgramId {
    return "SwapLayer1111111111111111111111111111111111";
}
