export * from "./consts";
export * from "./messages";
export * from "./relayerFees";
export * from "./state";

import * as wormholeSdk from "@certusone/wormhole-sdk";
import { BN, Program } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
    Uint64,
    uint64ToBN,
    uint64ToBigInt,
} from "@wormhole-foundation/example-liquidity-layer-solana/common";
import * as tokenRouterSdk from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter";
import { ChainId } from "@wormhole-foundation/sdk-base";
import { keccak256 } from "@wormhole-foundation/sdk-definitions";
import IDL from "../../../target/idl/swap_layer.json";
import { SwapLayer } from "../../../target/types/swap_layer";
import { OutputToken, encodeOutputToken } from "./messages";
import { Custodian, Peer, RedeemOption, RelayParams, StagedInbound, StagedOutbound } from "./state";
import { programDataAddress } from "./utils";

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
    encodedOutputToken: Buffer;
    payload: Buffer | null;
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
    private _usdcMint: PublicKey;

    program: Program<SwapLayer>;

    get ID(): PublicKey {
        return this.program.programId;
    }

    get usdcMint(): PublicKey {
        return this._usdcMint;
    }

    constructor(connection: Connection, programId: ProgramId, usdcMint: PublicKey) {
        this._programId = programId;
        this._usdcMint = usdcMint;
        this.program = new Program(
            { ...(IDL as any), address: this._programId },
            {
                connection,
            },
        );
    }

    connection(): Connection {
        return this.program.provider.connection;
    }

    custodianAddress(): PublicKey {
        return PublicKey.findProgramAddressSync([Buffer.from("custodian")], this.ID)[0];
    }

    peerAddress(chain: wormholeSdk.ChainId): PublicKey {
        return Peer.address(this.ID, chain);
    }

    usdcComposite(mint?: PublicKey): { mint: PublicKey } {
        return {
            mint: mint ?? this._usdcMint,
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

    registeredPeerComposite(opts: { peer?: PublicKey; chain?: ChainId }): RegisteredPeerComposite {
        const { peer, chain } = opts;
        if (peer === undefined && chain === undefined) {
            throw new Error("peer or chain must be provided");
        }
        return { peer: peer ?? this.peerAddress(chain) };
    }

    async consumeSwapLayerFillComposite(
        accounts: {
            preparedFill: PublicKey;
            beneficiary: PublicKey;
            sourcePeer?: PublicKey;
        },
        opts: { sourceChain?: wormholeSdk.ChainId } = {},
    ): Promise<{
        custodian: CheckedCustodianComposite;
        fill: PublicKey;
        fillCustodyToken: PublicKey;
        sourcePeer: RegisteredPeerComposite;
        beneficiary: PublicKey;
        tokenRouterProgram: PublicKey;
    }> {
        const { preparedFill, beneficiary } = accounts;

        let { sourcePeer: peer } = accounts;
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
            sourcePeer: { peer },
            beneficiary,
            tokenRouterProgram: tokenRouter.ID,
        };
    }

    swapAuthorityAddress(preparedSource: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("swap-authority"), preparedSource.toBuffer()],
            this.ID,
        )[0];
    }

    async swapAccounts(accounts: {
        authority: PublicKey;
        sourceMint: PublicKey;
        destinationMint: PublicKey;
        srcTokenProgram?: PublicKey;
        dstTokenProgram?: PublicKey;
    }): Promise<{
        srcSwapToken: PublicKey;
        dstSwapToken: PublicKey;
        srcTokenProgram: PublicKey;
        dstTokenProgram: PublicKey;
    }> {
        const { authority, sourceMint, destinationMint } = accounts;

        let { srcTokenProgram, dstTokenProgram } = accounts;
        if (srcTokenProgram === undefined) {
            const accInfo = await this.connection().getAccountInfo(sourceMint);
            srcTokenProgram = accInfo.owner;
        }
        if (dstTokenProgram === undefined) {
            const accInfo = await this.connection().getAccountInfo(destinationMint);
            dstTokenProgram = accInfo.owner;
        }

        return {
            srcSwapToken: splToken.getAssociatedTokenAddressSync(
                sourceMint,
                authority,
                true,
                srcTokenProgram,
            ),
            dstSwapToken: splToken.getAssociatedTokenAddressSync(
                destinationMint,
                authority,
                true,
                dstTokenProgram,
            ),
            srcTokenProgram,
            dstTokenProgram,
        };
    }

    stagedInboundAddress(preparedFill: PublicKey) {
        return StagedInbound.address(this.ID, preparedFill);
    }

    preparedOrderAddress(stagedOutbound: PublicKey) {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("prepared-order"), stagedOutbound.toBuffer()],
            this.ID,
        )[0];
    }
    async fetchStagedInbound(addr: PublicKey): Promise<StagedInbound> {
        return this.program.account.stagedInbound.fetch(addr);
    }

    async fetchStagedOutbound(addr: PublicKey): Promise<StagedOutbound> {
        return this.program.account.stagedOutbound.fetch(addr);
    }

    stagedCustodyTokenAddress(stagedAccount: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("staged-custody"), stagedAccount.toBuffer()],
            this.ID,
        )[0];
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
                feeRecipientToken: splToken.getAssociatedTokenAddressSync(
                    this.usdcMint,
                    feeRecipient,
                ),
                feeUpdater,
                programData: programDataAddress(this.ID),
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
                    this.usdcMint,
                    newFeeRecipient,
                ),
            })
            .instruction();
    }

    async closeStagedOutboundIx(
        accounts: {
            stagedOutbound: PublicKey;
            senderToken: PublicKey;
            preparedBy?: PublicKey;
            sender?: PublicKey;
        },
        targetChain: ChainId,
    ): Promise<TransactionInstruction> {
        const {
            stagedOutbound,
            preparedBy: inputPreparedBy,
            sender: inputSender,
            senderToken,
        } = accounts;

        const { preparedBy, sender } = await (async () => {
            if (inputPreparedBy === undefined || inputSender === undefined) {
                const {
                    info: { preparedBy, sender },
                } = await this.fetchStagedOutbound(stagedOutbound);
                return {
                    preparedBy: inputPreparedBy ?? preparedBy,
                    sender: inputSender ?? sender,
                };
            } else {
                return {
                    preparedBy: inputPreparedBy,
                    sender: inputSender,
                };
            }
        })();

        return this.program.methods
            .closeStagedOutbound()
            .accounts({
                sender,
                targetPeer: this.registeredPeerComposite({ chain: targetChain }),
                preparedBy,
                stagedOutbound,
                stagedCustodyToken: this.stagedCustodyTokenAddress(stagedOutbound),
                senderToken,
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .instruction();
    }

    async stageOutboundIx(
        accounts: {
            payer: PublicKey;
            stagedOutbound: PublicKey;
            usdcRefundToken: PublicKey;
            sender?: PublicKey | null;
            senderToken?: PublicKey | null;
            programTransferAuthority?: PublicKey | null;
            srcMint?: PublicKey;
            srcTokenProgram?: PublicKey;
            peer?: PublicKey;
        },
        args: {
            transferType: "native" | "programTransferAuthority" | "sender";
            amountIn: Uint64;
            isExactIn: boolean;
            targetChain: ChainId;
            recipient: Array<number>;
            redeemOption:
                | { relay: { gasDropoff: number; maxRelayerFee: Uint64 } }
                | { payload: Uint8Array | Buffer }
                | null;
            outputToken: OutputToken | null;
        },
    ): Promise<[approveIx: TransactionInstruction | null, stageIx: TransactionInstruction]> {
        const { payer, stagedOutbound, usdcRefundToken, peer } = accounts;
        const { transferType, amountIn, redeemOption: inputRedeemOption, outputToken } = args;

        let { sender, senderToken, programTransferAuthority, srcMint, srcTokenProgram } = accounts;
        srcMint ??= transferType === "native" ? splToken.NATIVE_MINT : this.usdcMint;
        if (srcTokenProgram === undefined) {
            const accInfo = await this.connection().getAccountInfo(srcMint);
            srcTokenProgram = accInfo.owner;
        }

        const redeemOption = ((): RedeemOption | null => {
            if (inputRedeemOption === null) {
                return null;
            } else if ("relay" in inputRedeemOption) {
                const { gasDropoff, maxRelayerFee } = inputRedeemOption.relay;
                return {
                    relay: {
                        gasDropoff,
                        maxRelayerFee: uint64ToBN(maxRelayerFee),
                    },
                };
            } else if ("payload" in inputRedeemOption) {
                const { payload } = inputRedeemOption;
                return { payload: [Buffer.from(payload)] };
            } else {
                throw new Error("invalid redeem option");
            }
        })();

        const encodedOutputToken =
            outputToken === null ? null : Buffer.from(encodeOutputToken(outputToken));
        const ixBuilder = this.program.methods.stageOutbound({
            ...args,
            amountIn: uint64ToBN(amountIn),
            redeemOption,
            encodedOutputToken,
        });

        if (transferType === "native") {
            if (sender === undefined) {
                sender = payer;
            }
            if (senderToken === undefined) {
                senderToken = null;
            }
            if (programTransferAuthority === undefined) {
                programTransferAuthority = null;
            }
        } else if (transferType === "programTransferAuthority") {
            if (sender === undefined) {
                sender = null;
            }
            // This checks if undefined or null.
            if (senderToken === undefined) {
                throw new Error("senderToken must be provided");
            }
        } else if (transferType === "sender") {
            if (sender === undefined) {
                sender = payer;
            }
            senderToken ??= splToken.getAssociatedTokenAddressSync(srcMint, sender);
            if (programTransferAuthority === undefined) {
                programTransferAuthority = null;
            }
        } else {
            throw new Error("invalid transfer type");
        }

        const definedAccounts = {
            payer,
            sender,
            programTransferAuthority: null,
            senderToken,
            targetPeer: this.registeredPeerComposite({ peer, chain: args.targetChain }),
            stagedOutbound,
            stagedCustodyToken: this.stagedCustodyTokenAddress(stagedOutbound),
            usdcRefundToken,
            srcMint,
            srcTokenProgram,
            tokenProgram: splToken.TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        };

        // TODO: This approval amount will not be correct if RedeemOption is Relay. Fix this.
        let approveIx: TransactionInstruction | null = null;
        if (programTransferAuthority === undefined) {
            if (transferType === "programTransferAuthority") {
                const hashedArgs = await ixBuilder
                    .accounts(definedAccounts)
                    .instruction()
                    .then((ix) => keccak256(ix.data.subarray(8)));

                // Replace the program transfer authority in the defined accounts.
                [programTransferAuthority] = PublicKey.findProgramAddressSync(
                    [Buffer.from("transfer-authority"), hashedArgs],
                    this.ID,
                );

                const owner = await splToken
                    .getAccount(this.connection(), senderToken)
                    .then((token) => token.owner)
                    .catch((_) => PublicKey.default);
                approveIx = splToken.createApproveInstruction(
                    senderToken,
                    programTransferAuthority,
                    owner,
                    uint64ToBigInt(amountIn),
                );

                definedAccounts.programTransferAuthority = programTransferAuthority;
            }
        }

        return [approveIx, await ixBuilder.accounts(definedAccounts).instruction()];
    }

    async initiateTransferIx(
        accounts: {
            payer: PublicKey;
            stagedOutbound: PublicKey;
            preparedOrder?: PublicKey;
            usdcRefundToken?: PublicKey;
            stagedCustodyToken?: PublicKey;
            preparedBy?: PublicKey;
        },
        opts: {
            targetChain?: ChainId;
        } = {},
    ) {
        let {
            payer,
            preparedOrder,
            usdcRefundToken,
            stagedOutbound,
            stagedCustodyToken,
            preparedBy,
        } = accounts;

        let { targetChain } = opts;
        if (
            targetChain === undefined ||
            usdcRefundToken === undefined ||
            preparedBy === undefined
        ) {
            const { info } = await this.fetchStagedOutbound(stagedOutbound);
            targetChain ??= info.targetChain as ChainId;
            usdcRefundToken ??= info.usdcRefundToken;
            preparedBy ??= info.preparedBy;
        }

        preparedOrder ??= this.preparedOrderAddress(stagedOutbound);
        stagedCustodyToken ??= this.stagedCustodyTokenAddress(stagedOutbound);

        return this.program.methods
            .initiateTransfer()
            .accounts({
                payer,
                custodian: this.checkedCustodianComposite(),
                preparedBy,
                stagedOutbound,
                stagedCustodyToken,
                usdcRefundToken,
                targetPeer: this.registeredPeerComposite({ chain: targetChain }),
                tokenRouterCustodian: this.tokenRouterProgram().custodianAddress(),
                preparedOrder,
                preparedCustodyToken:
                    this.tokenRouterProgram().preparedCustodyTokenAddress(preparedOrder),
                usdc: this.usdcComposite(),
                tokenRouterProgram: this.tokenRouterProgram().ID,
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .instruction();
    }

    async initiateSwapExactInIx(
        accounts: {
            payer: PublicKey;
            stagedOutbound: PublicKey;
            stagedCustodyToken?: PublicKey;
            preparedOrder?: PublicKey;
            srcMint?: PublicKey;
            srcTokenProgram?: PublicKey;
            preparedBy?: PublicKey;
            usdcRefundToken?: PublicKey;
        },
        args: {
            cpiInstruction: TransactionInstruction;
            targetChain?: ChainId;
        },
    ): Promise<TransactionInstruction> {
        const { payer, stagedOutbound } = accounts;
        const { cpiInstruction } = args;

        let {
            stagedCustodyToken,
            preparedOrder,
            srcMint,
            srcTokenProgram,
            preparedBy,
            usdcRefundToken,
        } = accounts;
        srcMint ??= splToken.NATIVE_MINT;

        let { targetChain } = args;
        if (
            targetChain === undefined ||
            usdcRefundToken === undefined ||
            preparedBy === undefined
        ) {
            const { info } = await this.fetchStagedOutbound(stagedOutbound);
            targetChain ??= info.targetChain as ChainId;
            usdcRefundToken ??= info.usdcRefundToken;
            preparedBy ??= info.preparedBy;
        }

        preparedOrder ??= this.preparedOrderAddress(stagedOutbound);
        stagedCustodyToken ??= this.stagedCustodyTokenAddress(stagedOutbound);

        const swapAuthority = this.swapAuthorityAddress(preparedOrder);
        const swapAccounts = await this.swapAccounts({
            authority: swapAuthority,
            sourceMint: srcMint,
            destinationMint: this.usdcMint,
            srcTokenProgram,
            dstTokenProgram: splToken.TOKEN_PROGRAM_ID,
        });
        const { srcSwapToken, dstSwapToken } = swapAccounts;
        srcTokenProgram ??= swapAccounts.srcTokenProgram;

        const tokenRouter = this.tokenRouterProgram();

        return this.program.methods
            .initiateSwapExactIn(cpiInstruction.data)
            .accounts({
                payer,
                custodian: this.checkedCustodianComposite(),
                preparedBy,
                stagedOutbound,
                stagedCustodyToken: this.stagedCustodyTokenAddress(stagedOutbound),
                usdcRefundToken,
                targetPeer: this.registeredPeerComposite({ chain: targetChain }),
                preparedOrder,
                swapAuthority,
                srcSwapToken,
                dstSwapToken,
                srcMint,
                usdc: this.usdcComposite(),
                tokenRouterCustodian: tokenRouter.custodianAddress(),
                preparedCustodyToken: tokenRouter.preparedCustodyTokenAddress(preparedOrder),
                tokenRouterProgram: tokenRouter.ID,
                associatedTokenProgram: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
                srcTokenProgram,
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .remainingAccounts(cpiInstruction.keys)
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
        recipientTokenAccount ??= splToken.getAssociatedTokenAddressSync(this.usdcMint, recipient);

        // Need the undefined check to satisfy the type checker.
        feeRecipientToken ??= await this.fetchCustodian().then((c) => c.feeRecipientToken);
        if (feeRecipientToken === undefined) {
            throw new Error("fee recipient token account not found");
        }

        return this.program.methods
            .completeTransferRelay()
            .accounts({
                payer,
                consumeSwapLayerFill: await this.consumeSwapLayerFillComposite(
                    {
                        preparedFill,
                        beneficiary,
                        sourcePeer: peer,
                    },
                    { sourceChain },
                ),
                completeTokenAccount: this.completeTokenAccountKey(preparedFill),
                recipient,
                recipientTokenAccount,
                usdc: this.usdcComposite(),
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
        recipientTokenAccount ??= splToken.getAssociatedTokenAddressSync(this.usdcMint, recipient);

        return this.program.methods
            .completeTransferDirect()
            .accounts({
                consumeSwapLayerFill: await this.consumeSwapLayerFillComposite(
                    {
                        preparedFill,
                        beneficiary,
                        sourcePeer: peer,
                    },
                    { sourceChain },
                ),
                recipient,
                recipientTokenAccount,
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
            })
            .instruction();
    }

    async completeTransferPayloadIx(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            peer?: PublicKey;
            beneficiary?: PublicKey;
        },
        sourceChain?: wormholeSdk.ChainId,
    ) {
        let { payer, preparedFill, peer, beneficiary } = accounts;

        beneficiary ??= payer;

        const stagedInbound = this.stagedInboundAddress(preparedFill);
        const stagedCustodyToken = this.stagedCustodyTokenAddress(stagedInbound);

        return this.program.methods
            .completeTransferPayload()
            .accounts({
                payer: payer,
                consumeSwapLayerFill: await this.consumeSwapLayerFillComposite(
                    {
                        preparedFill,
                        beneficiary,
                        sourcePeer: peer,
                    },
                    { sourceChain },
                ),
                stagedInbound,
                stagedCustodyToken,
                usdc: this.usdcComposite(),
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .instruction();
    }

    async releaseInboundIx(accounts: {
        stagedInbound: PublicKey;
        recipient: PublicKey;
        dstToken: PublicKey;
        beneficiary?: PublicKey;
        mint?: PublicKey;
        tokenProgram?: PublicKey;
    }): Promise<TransactionInstruction> {
        const { stagedInbound, recipient, dstToken } = accounts;

        let { beneficiary, mint, tokenProgram } = accounts;
        beneficiary ??= recipient;

        if (mint === undefined || tokenProgram === undefined) {
            const accInfo = await this.connection().getAccountInfo(dstToken);
            tokenProgram ??= accInfo.owner;
            mint ??= splToken.unpackAccount(dstToken, accInfo, accInfo.owner).mint;
        }

        return this.program.methods
            .releaseInbound()
            .accounts({
                recipient,
                beneficiary,
                stagedInbound,
                dstToken,
                stagedCustodyToken: this.stagedCustodyTokenAddress(stagedInbound),
                mint,
                tokenProgram,
            })
            .instruction();
    }

    async completeSwapDirectIx(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            recipient: PublicKey;
            dstMint?: PublicKey;
            recipientToken?: PublicKey;
            beneficiary?: PublicKey;
            dstTokenProgram?: PublicKey;
            feeRecipientToken?: PublicKey;
        },
        args: {
            cpiInstruction: TransactionInstruction;
        },
    ): Promise<TransactionInstruction> {
        const { payer, preparedFill, recipient } = accounts;
        const { cpiInstruction } = args;

        let { beneficiary, dstMint, dstTokenProgram, recipientToken, feeRecipientToken } = accounts;
        beneficiary ??= payer;
        dstMint ??= splToken.NATIVE_MINT;
        feeRecipientToken ??= await this.fetchCustodian().then((c) => c.feeRecipientToken);

        const swapAuthority = this.swapAuthorityAddress(preparedFill);
        const swapAccounts = await this.swapAccounts({
            authority: swapAuthority,
            sourceMint: this.usdcMint,
            destinationMint: dstMint,
            srcTokenProgram: splToken.TOKEN_PROGRAM_ID,
            dstTokenProgram,
        });
        const { srcSwapToken, dstSwapToken } = swapAccounts;
        dstTokenProgram ??= swapAccounts.dstTokenProgram;
        recipientToken ??= splToken.getAssociatedTokenAddressSync(
            dstMint,
            recipient,
            true,
            dstTokenProgram,
        );

        return this.program.methods
            .completeSwapDirect(cpiInstruction.data)
            .accounts({
                completeSwap: {
                    payer,
                    consumeSwapLayerFill: await this.consumeSwapLayerFillComposite({
                        preparedFill,
                        beneficiary,
                    }),
                    authority: swapAuthority,
                    srcSwapToken,
                    dstSwapToken,
                    feeRecipientToken,
                    usdc: this.usdcComposite(),
                    dstMint,
                    associatedTokenProgram: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: splToken.TOKEN_PROGRAM_ID,
                    dstTokenProgram,
                    systemProgram: SystemProgram.programId,
                },
                recipientToken,
                recipient,
            })
            .remainingAccounts(cpiInstruction.keys)
            .instruction();
    }

    async completeSwapRelayIx(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            recipient: PublicKey;
            dstMint?: PublicKey;
            beneficiary?: PublicKey;
            dstTokenProgram?: PublicKey;
            feeRecipientToken?: PublicKey;
            recipientToken?: PublicKey;
        },
        args: {
            cpiInstruction: TransactionInstruction;
        },
    ): Promise<TransactionInstruction> {
        const { payer, preparedFill, recipient } = accounts;
        const { cpiInstruction } = args;

        let { beneficiary, dstMint, dstTokenProgram, feeRecipientToken, recipientToken } = accounts;
        beneficiary ??= payer;
        dstMint ??= splToken.NATIVE_MINT;
        feeRecipientToken ??= await this.fetchCustodian().then((c) => c.feeRecipientToken);

        const swapAuthority = this.swapAuthorityAddress(preparedFill);
        const swapAccounts = await this.swapAccounts({
            authority: swapAuthority,
            sourceMint: this.usdcMint,
            destinationMint: dstMint,
            srcTokenProgram: splToken.TOKEN_PROGRAM_ID,
            dstTokenProgram,
        });
        const { srcSwapToken, dstSwapToken } = swapAccounts;
        dstTokenProgram ??= swapAccounts.dstTokenProgram;
        recipientToken ??= splToken.getAssociatedTokenAddressSync(
            dstMint,
            recipient,
            true,
            dstTokenProgram,
        );

        return this.program.methods
            .completeSwapRelay(cpiInstruction.data)
            .accounts({
                completeSwap: {
                    payer,
                    consumeSwapLayerFill: await this.consumeSwapLayerFillComposite({
                        preparedFill,
                        beneficiary,
                    }),
                    authority: swapAuthority,
                    srcSwapToken,
                    dstSwapToken,
                    feeRecipientToken,
                    usdc: this.usdcComposite(),
                    dstMint,
                    associatedTokenProgram: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: splToken.TOKEN_PROGRAM_ID,
                    dstTokenProgram,
                    systemProgram: SystemProgram.programId,
                },
                recipientToken,
                recipient,
            })
            .remainingAccounts(cpiInstruction.keys)
            .instruction();
    }

    async completeSwapPayloadIx(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            dstMint?: PublicKey;
            beneficiary?: PublicKey;
            dstTokenProgram?: PublicKey;
            feeRecipientToken?: PublicKey;
        },
        args: {
            cpiInstruction: TransactionInstruction;
        },
    ): Promise<TransactionInstruction> {
        const { payer, preparedFill } = accounts;
        const { cpiInstruction } = args;

        let { beneficiary, dstMint, dstTokenProgram, feeRecipientToken } = accounts;
        beneficiary ??= payer;
        dstMint ??= splToken.NATIVE_MINT;

        const stagedInbound = this.stagedInboundAddress(preparedFill);
        const swapAccounts = await this.swapAccounts({
            authority: stagedInbound,
            sourceMint: this.usdcMint,
            destinationMint: dstMint,
            srcTokenProgram: splToken.TOKEN_PROGRAM_ID,
            dstTokenProgram,
        });
        const { srcSwapToken, dstSwapToken } = swapAccounts;
        dstTokenProgram ??= swapAccounts.dstTokenProgram;
        feeRecipientToken ??= await this.fetchCustodian().then((c) => c.feeRecipientToken);

        return this.program.methods
            .completeSwapPayload(cpiInstruction.data)
            .accounts({
                payer,
                consumeSwapLayerFill: await this.consumeSwapLayerFillComposite({
                    preparedFill,
                    beneficiary,
                }),
                stagedInbound,
                srcSwapToken,
                dstSwapToken,
                feeRecipientToken,
                usdc: this.usdcComposite(),
                dstMint,
                associatedTokenProgram: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
                tokenProgram: splToken.TOKEN_PROGRAM_ID,
                dstTokenProgram,
                systemProgram: SystemProgram.programId,
            })
            .remainingAccounts(cpiInstruction.keys)
            .instruction();
    }

    tokenRouterProgram(): tokenRouterSdk.TokenRouterProgram {
        switch (this._programId) {
            case localnet(): {
                return new tokenRouterSdk.TokenRouterProgram(
                    this.connection(),
                    tokenRouterSdk.localnet(),
                    this.usdcMint,
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
