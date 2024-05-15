import { BN } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import {
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import { CctpTokenBurnMessage } from "@wormhole-foundation/example-liquidity-layer-solana/cctp";
import {
    LiquidityLayerDeposit,
    LiquidityLayerMessage,
} from "@wormhole-foundation/example-liquidity-layer-solana/common";
import {
    CircleAttester,
    ETHEREUM_USDC_ADDRESS,
    LOCALHOST,
    MOCK_GUARDIANS,
    OWNER_ASSISTANT_KEYPAIR,
    OWNER_KEYPAIR,
    PAYER_KEYPAIR,
    REGISTERED_TOKEN_ROUTERS,
    USDC_MINT_ADDRESS,
    expectIxErr,
    expectIxOk,
    getUsdcAtaBalance,
    postLiquidityLayerVaa,
} from "@wormhole-foundation/example-liquidity-layer-solana/testing";
import * as tokenRouterSdk from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter";
import { PreparedOrder } from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter/state";
import { ChainId, toChainId } from "@wormhole-foundation/sdk-base";
import { UniversalAddress } from "@wormhole-foundation/sdk-definitions";
import { use as chaiUse, expect } from "chai";
import {
    AddPeerArgs,
    Custodian,
    Peer,
    RelayParams,
    StagedInbound,
    SwapLayerProgram,
    U32_MAX,
    UpdateRelayParametersArgs,
    calculateRelayerFee,
    denormalizeGasDropOff,
    encodeSwapLayerMessage,
    localnet,
    encodeOutputToken,
} from "../src/swapLayer";
import {
    FEE_UPDATER_KEYPAIR,
    REGISTERED_PEERS,
    createLut,
    hackedExpectDeepEqual,
    tryNativeToUint8Array,
} from "./helpers";

chaiUse(require("chai-as-promised"));

const SOLANA_CHAIN_ID = toChainId("Solana");

describe("Swap Layer", () => {
    const connection = new Connection(LOCALHOST, "processed");
    const payer = PAYER_KEYPAIR;
    const owner = OWNER_KEYPAIR;
    const recipient = Keypair.generate();
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;
    const feeUpdater = FEE_UPDATER_KEYPAIR;
    const feeRecipient = Keypair.generate().publicKey;
    const feeRecipientToken = splToken.getAssociatedTokenAddressSync(
        USDC_MINT_ADDRESS,
        feeRecipient,
    );
    const newFeeRecipient = Keypair.generate().publicKey;

    // Sending chain information.
    const foreignChain = toChainId("Ethereum");
    const foreignTokenRouterAddress = REGISTERED_TOKEN_ROUTERS["Ethereum"]!;
    const foreignSwapLayerAddress = REGISTERED_PEERS["Ethereum"]!;
    const foreignRecipientAddress = Array.from(
        Buffer.alloc(32, "0000000000000000000000beefdeadCf7178C407aA7369b67CB7edeadbeef", "hex"),
    );

    // Program SDKs
    const swapLayer = new SwapLayerProgram(connection, localnet(), USDC_MINT_ADDRESS);
    const tokenRouter = new tokenRouterSdk.TokenRouterProgram(
        connection,
        tokenRouterSdk.localnet(),
        USDC_MINT_ADDRESS,
    );

    let tokenRouterLkupTable: PublicKey;

    const relayParamsForTest: RelayParams = {
        baseFee: 100000,
        nativeTokenPrice: new BN(1000000),
        maxGasDropoff: 500000,
        gasDropoffMargin: 10000,
        executionParams: {
            evm: {
                gasPrice: 100000,
                gasPriceMargin: 10000,
            },
        },
    };

    describe("Admin", () => {
        describe("Initialize", () => {
            it("Initialize", async () => {
                const ix = await swapLayer.initializeIx({
                    owner: payer.publicKey,
                    ownerAssistant: ownerAssistant.publicKey,
                    feeRecipient: feeRecipient,
                    feeUpdater: feeUpdater.publicKey,
                });

                await expectIxOk(connection, [ix], [payer]);

                const custodianData = await swapLayer.fetchCustodian();

                hackedExpectDeepEqual(
                    custodianData,
                    new Custodian(
                        payer.publicKey,
                        null,
                        ownerAssistant.publicKey,
                        feeRecipientToken,
                        feeUpdater.publicKey,
                    ),
                );
            });

            before("Set up Token Accounts", async function () {
                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    feeRecipient,
                );

                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    PublicKey.default,
                );

                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    SystemProgram.programId,
                );

                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    recipient.publicKey,
                );
            });

            after("Setup Lookup Table", async function () {
                const usdcCommonAccounts = await tokenRouter.commonAccounts();

                tokenRouterLkupTable = await createLut(
                    connection,
                    payer,
                    Object.values(usdcCommonAccounts).filter((key) => key !== undefined),
                );
            });

            after("Transfer Lamports to Owner and Owner Assistant", async function () {
                await expectIxOk(
                    connection,
                    [
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: owner.publicKey,
                            lamports: 1000000000,
                        }),
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: ownerAssistant.publicKey,
                            lamports: 1000000000,
                        }),
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: feeUpdater.publicKey,
                            lamports: 1000000000,
                        }),
                    ],
                    [payer],
                );
            });
        });

        describe("Peer Registration", () => {
            const startParams: RelayParams = {
                baseFee: 200000,
                nativeTokenPrice: new BN(4000000),
                maxGasDropoff: 200000,
                gasDropoffMargin: 50000,
                executionParams: {
                    evm: {
                        gasPrice: 500000,
                        gasPriceMargin: 50000,
                    },
                },
            };

            describe("Add", () => {
                const createAddPeerIx = (opts?: {
                    ownerOrAssistant?: PublicKey;
                    args?: AddPeerArgs;
                }) =>
                    swapLayer.addPeerIx(
                        {
                            ownerOrAssistant: opts?.ownerOrAssistant ?? payer.publicKey,
                        },
                        opts?.args ?? {
                            chain: foreignChain,
                            address: foreignRecipientAddress,
                            relayParams: startParams,
                        },
                    );

                it("Cannot Add Peer (Only Owner or Assistant)", async () => {
                    await expectIxErr(
                        connection,
                        [await createAddPeerIx({ ownerOrAssistant: feeUpdater.publicKey })],
                        [feeUpdater],
                        "OwnerOrAssistantOnly",
                    );
                });

                it("Cannot Add Peer (ChainId == 0)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createAddPeerIx({
                                args: {
                                    chain: 0,
                                    address: foreignSwapLayerAddress,
                                    relayParams: startParams,
                                },
                            }),
                        ],
                        [payer],
                        "ChainNotAllowed",
                    );
                });

                it("Cannot Add Peer (ChainId == 1)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createAddPeerIx({
                                args: {
                                    chain: SOLANA_CHAIN_ID,
                                    address: foreignSwapLayerAddress,
                                    relayParams: startParams,
                                },
                            }),
                        ],
                        [payer],
                        "ChainNotAllowed",
                    );
                });

                it("Cannot Add Peer (InvalidPeer)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createAddPeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: new Array(32).fill(0),
                                    relayParams: startParams,
                                },
                            }),
                        ],
                        [payer],
                        "InvalidPeer",
                    );
                });

                it("Cannot Add Peer (Invalid Base Fee)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createAddPeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: foreignSwapLayerAddress,
                                    relayParams: { ...startParams, baseFee: 0 },
                                },
                            }),
                        ],
                        [payer],
                        "InvalidBaseFee",
                    );
                });

                it("Cannot Add Peer (Invalid Native Token Price)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createAddPeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: foreignSwapLayerAddress,
                                    relayParams: { ...startParams, nativeTokenPrice: new BN(0) },
                                },
                            }),
                        ],
                        [payer],
                        "InvalidNativeTokenPrice",
                    );
                });

                it("Cannot Add Peer (Invalid Gas Dropoff Margin)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createAddPeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: foreignSwapLayerAddress,
                                    relayParams: { ...startParams, gasDropoffMargin: 4294967295 },
                                },
                            }),
                        ],
                        [payer],
                        "InvalidMargin",
                    );
                });

                it("Cannot Add Peer (Invalid Gas Price)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createAddPeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: foreignSwapLayerAddress,
                                    relayParams: {
                                        ...startParams,
                                        executionParams: {
                                            evm: { gasPrice: 0, gasPriceMargin: 69 },
                                        },
                                    },
                                },
                            }),
                        ],
                        [payer],
                        "InvalidGasPrice",
                    );
                });

                it("Cannot Add Peer (Invalid Gas Price Margin)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createAddPeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: foreignSwapLayerAddress,
                                    relayParams: {
                                        ...startParams,
                                        executionParams: {
                                            evm: { gasPrice: 10000, gasPriceMargin: 4294967295 },
                                        },
                                    },
                                },
                            }),
                        ],
                        [payer],
                        "InvalidMargin",
                    );
                });

                it("Add Peer As Owner", async () => {
                    await expectIxOk(connection, [await createAddPeerIx()], [payer]);

                    const peer = await swapLayer.fetchPeer(foreignChain);
                    hackedExpectDeepEqual(
                        peer,
                        new Peer(foreignChain, foreignRecipientAddress, startParams),
                    );
                });
            });

            describe("Update", () => {
                const createUpdatePeerIx = (opts?: { owner?: PublicKey; args?: AddPeerArgs }) =>
                    swapLayer.updatePeerIx(
                        {
                            owner: opts?.owner ?? payer.publicKey,
                        },
                        opts?.args ?? {
                            chain: foreignChain,
                            address: foreignSwapLayerAddress,
                            relayParams: relayParamsForTest,
                        },
                    );

                it("Cannot Update Peer (Owner Only)", async () => {
                    expectIxErr(
                        connection,
                        [await createUpdatePeerIx({ owner: ownerAssistant.publicKey })],
                        [ownerAssistant],
                        "OwnerOnly",
                    );
                });

                it("Cannot Update Peer (InvalidPeer)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createUpdatePeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: new Array(32).fill(0),
                                    relayParams: startParams,
                                },
                            }),
                        ],
                        [payer],
                        "InvalidPeer",
                    );
                });

                it("Cannot Update Peer (Invalid Base Fee)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createUpdatePeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: foreignSwapLayerAddress,
                                    relayParams: { ...relayParamsForTest, baseFee: 0 },
                                },
                            }),
                        ],
                        [payer],
                        "InvalidBaseFee",
                    );
                });

                it("Cannot Update Peer (Invalid Native Token Price)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createUpdatePeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: foreignSwapLayerAddress,
                                    relayParams: {
                                        ...relayParamsForTest,
                                        nativeTokenPrice: new BN(0),
                                    },
                                },
                            }),
                        ],
                        [payer],
                        "InvalidNativeTokenPrice",
                    );
                });

                it("Cannot Update Peer (Invalid Gas Dropoff Margin)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createUpdatePeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: foreignSwapLayerAddress,
                                    relayParams: {
                                        ...relayParamsForTest,
                                        gasDropoffMargin: 4294967295,
                                    },
                                },
                            }),
                        ],
                        [payer],
                        "InvalidMargin",
                    );
                });

                it("Cannot Update Peer (Invalid Gas Price)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createUpdatePeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: foreignSwapLayerAddress,
                                    relayParams: {
                                        ...relayParamsForTest,
                                        executionParams: {
                                            evm: { gasPrice: 0, gasPriceMargin: 69 },
                                        },
                                    },
                                },
                            }),
                        ],
                        [payer],
                        "InvalidGasPrice",
                    );
                });

                it("Cannot Update Peer (Invalid Gas Price Margin)", async () => {
                    await expectIxErr(
                        connection,
                        [
                            await createUpdatePeerIx({
                                args: {
                                    chain: foreignChain,
                                    address: foreignSwapLayerAddress,
                                    relayParams: {
                                        ...relayParamsForTest,
                                        executionParams: {
                                            evm: { gasPrice: 10000, gasPriceMargin: 4294967295 },
                                        },
                                    },
                                },
                            }),
                        ],
                        [payer],
                        "InvalidMargin",
                    );
                });

                it("Update Peer As Owner", async () => {
                    await expectIxOk(connection, [await createUpdatePeerIx()], [payer]);

                    const peer = await swapLayer.fetchPeer(foreignChain);
                    hackedExpectDeepEqual(
                        peer,
                        new Peer(foreignChain, foreignSwapLayerAddress, relayParamsForTest),
                    );
                });
            });
        });

        describe("Ownership Transfer Request", async function () {
            const createSubmitOwnershipTransferIx = (opts?: {
                sender?: PublicKey;
                newOwner?: PublicKey;
            }) =>
                swapLayer.submitOwnershipTransferIx({
                    owner: opts?.sender ?? owner.publicKey,
                    newOwner: opts?.newOwner ?? feeUpdater.publicKey,
                });

            const createConfirmOwnershipTransferIx = (opts?: { sender?: PublicKey }) =>
                swapLayer.confirmOwnershipTransferIx({
                    pendingOwner: opts?.sender ?? feeUpdater.publicKey,
                });

            // Instruction to cancel an ownership transfer request.
            const createCancelOwnershipTransferIx = (opts?: { sender?: PublicKey }) =>
                swapLayer.cancelOwnershipTransferIx({
                    owner: opts?.sender ?? owner.publicKey,
                });

            it("Submit Ownership Transfer Request as Deployer (Payer)", async function () {
                await expectIxOk(
                    connection,
                    [
                        await createSubmitOwnershipTransferIx({
                            sender: payer.publicKey,
                            newOwner: owner.publicKey,
                        }),
                    ],
                    [payer],
                );

                // Confirm that the pending owner variable is set in the owner config.
                const custodianData = await swapLayer.fetchCustodian();

                hackedExpectDeepEqual(custodianData.pendingOwner, owner.publicKey);
            });

            it("Confirm Ownership Transfer Request as Pending Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createConfirmOwnershipTransferIx({ sender: owner.publicKey })],
                    [payer, owner],
                );

                // Confirm that the custodian reflects the current ownership status.
                {
                    const custodianData = await swapLayer.fetchCustodian();
                    hackedExpectDeepEqual(custodianData.owner, owner.publicKey);
                    hackedExpectDeepEqual(custodianData.pendingOwner, null);
                }
            });

            it("Cannot Submit Ownership Transfer Request (New Owner == Address(0))", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createSubmitOwnershipTransferIx({
                            newOwner: PublicKey.default,
                        }),
                    ],
                    [payer, owner],
                    "InvalidNewOwner",
                );
            });

            it("Cannot Submit Ownership Transfer Request (New Owner == Owner)", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createSubmitOwnershipTransferIx({
                            newOwner: owner.publicKey,
                        }),
                    ],
                    [payer, owner],
                    "AlreadyOwner",
                );
            });

            it("Cannot Submit Ownership Transfer Request as Non-Owner", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createSubmitOwnershipTransferIx({
                            sender: ownerAssistant.publicKey,
                        }),
                    ],
                    [payer, ownerAssistant],
                    "OwnerOnly",
                );
            });

            it("Submit Ownership Transfer Request as Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createSubmitOwnershipTransferIx()],
                    [payer, owner],
                );

                // Confirm that the pending owner variable is set in the owner config.
                const custodianData = await swapLayer.fetchCustodian();
                expect(custodianData.pendingOwner).to.eql(feeUpdater.publicKey);
            });

            it("Cannot Confirm Ownership Transfer Request as Non Pending Owner", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createConfirmOwnershipTransferIx({
                            sender: ownerAssistant.publicKey,
                        }),
                    ],
                    [payer, ownerAssistant],
                    "NotPendingOwner",
                );
            });

            it("Confirm Ownership Transfer Request as Pending Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createConfirmOwnershipTransferIx()],
                    [payer, feeUpdater],
                );

                // Confirm that the custodian reflects the current ownership status.
                {
                    const custodianData = await swapLayer.fetchCustodian();
                    hackedExpectDeepEqual(custodianData.owner, feeUpdater.publicKey);
                    hackedExpectDeepEqual(custodianData.pendingOwner, null);
                }

                // Set the owner back to the payer key.
                await expectIxOk(
                    connection,
                    [
                        await createSubmitOwnershipTransferIx({
                            sender: feeUpdater.publicKey,
                            newOwner: owner.publicKey,
                        }),
                    ],
                    [payer, feeUpdater],
                );

                await expectIxOk(
                    connection,
                    [await createConfirmOwnershipTransferIx({ sender: owner.publicKey })],
                    [payer, owner],
                );

                // Confirm that the payer is the owner again.
                {
                    const custodianData = await swapLayer.fetchCustodian();
                    hackedExpectDeepEqual(custodianData.owner, owner.publicKey);
                    hackedExpectDeepEqual(custodianData.pendingOwner, null);
                }
            });

            it("Cannot Cancel Ownership Request as Non-Owner", async function () {
                // First, submit the ownership transfer request.
                await expectIxOk(
                    connection,
                    [await createSubmitOwnershipTransferIx()],
                    [payer, owner],
                );

                // Confirm that the pending owner variable is set in the owner config.
                {
                    const custodianData = await swapLayer.fetchCustodian();
                    expect(custodianData.pendingOwner).to.eql(feeUpdater.publicKey);
                }

                // Confirm that the cancel ownership transfer request fails.
                await expectIxErr(
                    connection,
                    [await createCancelOwnershipTransferIx({ sender: ownerAssistant.publicKey })],
                    [payer, ownerAssistant],
                    "OwnerOnly",
                );
            });

            it("Cancel Ownership Request as Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createCancelOwnershipTransferIx()],
                    [payer, owner],
                );

                // Confirm the pending owner field was reset.
                const custodianData = await swapLayer.fetchCustodian();
                expect(custodianData.pendingOwner).to.eql(null);
            });
        });

        describe("Update Owner Assistant", async function () {
            // Create the update owner assistant instruction.
            const createUpdateOwnerAssistantIx = (opts?: {
                sender?: PublicKey;
                newAssistant?: PublicKey;
            }) =>
                swapLayer.updateOwnerAssistantIx({
                    owner: opts?.sender ?? owner.publicKey,
                    newOwnerAssistant: opts?.newAssistant ?? feeUpdater.publicKey,
                });

            it("Cannot Update Assistant (New Assistant == Address(0))", async function () {
                await expectIxErr(
                    connection,
                    [await createUpdateOwnerAssistantIx({ newAssistant: PublicKey.default })],
                    [payer, owner],
                    "AssistantZeroPubkey",
                );
            });

            it("Cannot Update Assistant as Non-Owner", async function () {
                await expectIxErr(
                    connection,
                    [await createUpdateOwnerAssistantIx({ sender: ownerAssistant.publicKey })],
                    [payer, ownerAssistant],
                    "OwnerOnly",
                );
            });

            it("Update Assistant as Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createUpdateOwnerAssistantIx()],
                    [payer, owner],
                );

                // Confirm the assistant field was updated.
                const custodianData = await swapLayer.fetchCustodian();
                expect(custodianData.ownerAssistant).to.eql(feeUpdater.publicKey);

                // Set the assistant back to the assistant key.
                await expectIxOk(
                    connection,
                    [
                        await createUpdateOwnerAssistantIx({
                            newAssistant: ownerAssistant.publicKey,
                        }),
                    ],
                    [payer, owner],
                );
            });
        });

        describe("Update Fee Updater", async function () {
            // Create the update owner assistant instruction.
            const createUpdateFeeUpdaterIx = (opts?: {
                sender?: PublicKey;
                newFeeUpdater?: PublicKey;
            }) =>
                swapLayer.updateFeeUpdaterIx({
                    ownerOrAssistant: opts?.sender ?? owner.publicKey,
                    newFeeUpdater: opts?.newFeeUpdater ?? feeRecipient,
                });

            it("Cannot Update Fee Updater (New Fee Updater == Address(0))", async function () {
                await expectIxErr(
                    connection,
                    [await createUpdateFeeUpdaterIx({ newFeeUpdater: PublicKey.default })],
                    [payer, owner],
                    "FeeUpdaterZeroPubkey",
                );
            });

            it("Cannot Update Fee Updater Without Owner or Assistant", async function () {
                await expectIxErr(
                    connection,
                    [await createUpdateFeeUpdaterIx({ sender: payer.publicKey })],
                    [payer],
                    "OwnerOrAssistantOnly",
                );
            });

            it("Update Fee Updater as Owner", async function () {
                await expectIxOk(connection, [await createUpdateFeeUpdaterIx()], [payer, owner]);

                // Confirm the fee updater field was updated.
                const custodianData = await swapLayer.fetchCustodian();
                hackedExpectDeepEqual(custodianData.feeRecipientToken, feeRecipientToken);

                // Revert back to original fee updater.
                await expectIxOk(
                    connection,
                    [
                        await createUpdateFeeUpdaterIx({
                            newFeeUpdater: feeUpdater.publicKey,
                        }),
                    ],
                    [payer, owner],
                );
            });
        });

        describe("Update Fee Recipient", async function () {
            const localVariables = new Map<string, any>();

            it("Cannot Update Fee Recipient with Non-Existent ATA", async function () {
                const ix = await swapLayer.updateFeeRecipientIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    newFeeRecipient,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "new_fee_recipient_token. Error Code: AccountNotInitialized",
                );

                localVariables.set("ix", ix);
            });

            it("Update Fee Recipient as Owner Assistant", async function () {
                const ix = localVariables.get("ix") as TransactionInstruction;
                expect(localVariables.delete("ix")).is.true;

                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    newFeeRecipient,
                );

                await expectIxOk(connection, [ix], [ownerAssistant]);

                const custodianData = await swapLayer.fetchCustodian();
                expect(custodianData.feeRecipientToken).to.eql(
                    splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, newFeeRecipient),
                );
            });

            it("Cannot Update Fee Recipient without Owner or Assistant", async function () {
                const ix = await swapLayer.updateFeeRecipientIx({
                    ownerOrAssistant: payer.publicKey,
                    newFeeRecipient: feeRecipient,
                });

                await expectIxErr(connection, [ix], [payer], "Error Code: OwnerOrAssistantOnly");
            });

            it("Cannot Update Fee Recipient to Default Pubkey", async function () {
                const ix = await swapLayer.updateFeeRecipientIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    newFeeRecipient: PublicKey.default,
                });

                await expectIxErr(connection, [ix], [ownerAssistant], "FeeRecipientZeroPubkey");
            });

            it("Update Fee Recipient as Owner", async function () {
                const ix = await swapLayer.updateFeeRecipientIx({
                    ownerOrAssistant: owner.publicKey,
                    newFeeRecipient: feeRecipient,
                });
                await expectIxOk(connection, [ix], [owner]);

                const custodianData = await swapLayer.fetchCustodian();
                expect(custodianData.feeRecipientToken).to.eql(feeRecipientToken);
            });
        });

        describe("Update Relay Parameters", () => {
            const updateParams: RelayParams = {
                baseFee: 200000,
                nativeTokenPrice: new BN(4000000),
                maxGasDropoff: 200000,
                gasDropoffMargin: 50000,
                executionParams: {
                    evm: {
                        gasPrice: 500000,
                        gasPriceMargin: 50000,
                    },
                },
            };

            const createUpdateRelayParamsIx = (opts?: {
                feeUpdater?: PublicKey;
                args?: UpdateRelayParametersArgs;
            }) =>
                swapLayer.updateRelayParamsIx(
                    {
                        feeUpdater: opts?.feeUpdater ?? feeUpdater.publicKey,
                    },
                    opts?.args ?? {
                        chain: foreignChain,
                        relayParams: updateParams,
                    },
                );

            it("Cannot Update Relay Parameters (Invalid Fee Updater)", async () => {
                await expectIxErr(
                    connection,
                    [await createUpdateRelayParamsIx({ feeUpdater: payer.publicKey })],
                    [payer],
                    "InvalidFeeUpdater",
                );
            });

            it("Cannot Update Relay Parameters (Invalid Base Fee)", async () => {
                await expectIxErr(
                    connection,
                    [
                        await createUpdateRelayParamsIx({
                            args: {
                                chain: foreignChain,
                                relayParams: { ...updateParams, baseFee: 0 },
                            },
                        }),
                    ],
                    [feeUpdater],
                    "InvalidBaseFee",
                );
            });

            it("Cannot Update Relay Parameters (Invalid Native Token Price)", async () => {
                await expectIxErr(
                    connection,
                    [
                        await createUpdateRelayParamsIx({
                            args: {
                                chain: foreignChain,
                                relayParams: { ...updateParams, nativeTokenPrice: new BN(0) },
                            },
                        }),
                    ],
                    [feeUpdater],
                    "InvalidNativeTokenPrice",
                );
            });

            it("Cannot Update Relay Parameters (Invalid Gas Dropoff Margin)", async () => {
                await expectIxErr(
                    connection,
                    [
                        await createUpdateRelayParamsIx({
                            args: {
                                chain: foreignChain,
                                relayParams: { ...updateParams, gasDropoffMargin: 4294967295 },
                            },
                        }),
                    ],
                    [feeUpdater],
                    "InvalidMargin",
                );
            });

            it("Cannot Update Relay Parameters (Invalid Gas Price)", async () => {
                await expectIxErr(
                    connection,
                    [
                        await createUpdateRelayParamsIx({
                            args: {
                                chain: foreignChain,
                                relayParams: {
                                    ...updateParams,
                                    executionParams: { evm: { gasPrice: 0, gasPriceMargin: 69 } },
                                },
                            },
                        }),
                    ],
                    [feeUpdater],
                    "InvalidGasPrice",
                );
            });

            it("Cannot Update Relay Parameters (Invalid Gas Price Margin)", async () => {
                await expectIxErr(
                    connection,
                    [
                        await createUpdateRelayParamsIx({
                            args: {
                                chain: foreignChain,
                                relayParams: {
                                    ...updateParams,
                                    executionParams: {
                                        evm: { gasPrice: 10000, gasPriceMargin: 4294967295 },
                                    },
                                },
                            },
                        }),
                    ],
                    [feeUpdater],
                    "InvalidMargin",
                );
            });

            it("Update Relay Parameters as Owner", async () => {
                let relayParams = {
                    ...relayParamsForTest,
                    baseFee: 69,
                };
                await expectIxOk(
                    connection,
                    [
                        await createUpdateRelayParamsIx({
                            feeUpdater: owner.publicKey,
                            args: {
                                chain: foreignChain,
                                relayParams,
                            },
                        }),
                    ],
                    [owner],
                );

                const peer = await swapLayer.fetchPeer(foreignChain);
                hackedExpectDeepEqual(peer.relayParams, relayParams);
            });

            it("Update Relay Parameters as Owner Assistant", async () => {
                let relayParams = {
                    ...relayParamsForTest,
                    baseFee: 690,
                };
                await expectIxOk(
                    connection,
                    [
                        await createUpdateRelayParamsIx({
                            feeUpdater: owner.publicKey,
                            args: {
                                chain: foreignChain,
                                relayParams,
                            },
                        }),
                    ],
                    [owner],
                );

                const peer = await swapLayer.fetchPeer(foreignChain);
                hackedExpectDeepEqual(peer.relayParams, relayParams);
            });

            it("Update Relay Parameters as Fee Updater", async () => {
                let relayParams = {
                    ...relayParamsForTest,
                };
                await expectIxOk(
                    connection,
                    [
                        await createUpdateRelayParamsIx({
                            feeUpdater: owner.publicKey,
                            args: {
                                chain: foreignChain,
                                relayParams,
                            },
                        }),
                    ],
                    [owner],
                );

                const peer = await swapLayer.fetchPeer(foreignChain);
                hackedExpectDeepEqual(peer.relayParams, relayParams);
            });
        });
    });

    describe("Business Logic", function () {
        let testCctpNonce = 2n ** 64n - 20n * 6400n;

        let wormholeSequence = 2000n;
        describe("USDC Transfer (Relay)", function () {
            describe("Outbound", function () {
                it("Cannot Initiate Transfer (Invalid Prepared Order)", async function () {
                    const amountIn = 6900000000n;
                    const gasDropoff = 100000;
                    const maxRelayerFee = 9999999999999;

                    // Pass the payer key as the prepared order.
                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: payer.publicKey,
                        },
                        {
                            amountIn: new BN(amountIn.toString()),
                            targetChain: foreignChain,
                            relayOptions: {
                                gasDropoff: gasDropoff,
                                maxRelayerFee: new BN(maxRelayerFee),
                            },
                            recipient: foreignRecipientAddress,
                            encodedOutputToken: Buffer.from(encodeOutputToken({ type: "Usdc" })),
                            payload: null,
                        },
                    );

                    await expectIxErr(connection, [ix], [payer], "InvalidPreparedOrder");
                });

                it("Cannot Initiate Transfer (Invalid Peer)", async function () {
                    const amountIn = 6900000000n;
                    const gasDropoff = 100000;
                    const maxRelayerFee = 9999999999999;
                    const invalidChain = 69;

                    const preparedOrder = Keypair.generate();

                    // Pass the payer key as the prepared order.
                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: preparedOrder.publicKey,
                        },
                        {
                            amountIn: new BN(amountIn.toString()),
                            targetChain: invalidChain,
                            relayOptions: {
                                gasDropoff: gasDropoff,
                                maxRelayerFee: new BN(maxRelayerFee),
                            },
                            recipient: foreignRecipientAddress,
                            encodedOutputToken: Buffer.from(encodeOutputToken({ type: "Usdc" })),
                            payload: null,
                        },
                    );

                    await expectIxErr(
                        connection,
                        [ix],
                        [payer, preparedOrder],
                        "AccountNotInitialized",
                    );
                });

                it("Cannot Initiate Transfer (Invalid Recipient)", async function () {
                    const amountIn = 6900000000n;
                    const gasDropoff = 100000;
                    const maxRelayerFee = 9999999999999;

                    const preparedOrder = Keypair.generate();

                    // Pass the payer key as the prepared order.
                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: preparedOrder.publicKey,
                        },
                        {
                            amountIn: new BN(amountIn.toString()),
                            targetChain: foreignChain,
                            relayOptions: {
                                gasDropoff: gasDropoff,
                                maxRelayerFee: new BN(maxRelayerFee),
                            },
                            recipient: new Array(32).fill(0),
                            encodedOutputToken: Buffer.from(encodeOutputToken({ type: "Usdc" })),
                            payload: null,
                        },
                    );

                    await expectIxErr(connection, [ix], [payer, preparedOrder], "InvalidRecipient");
                });

                it("Cannot Initiate Transfer (Max Relayer Fee Exceeded)", async function () {
                    const amountIn = 6900000000n;
                    const gasDropoff = 100000;

                    // Set the max relayer fee to the minimum.
                    const maxRelayerFee = 1;

                    const preparedOrder = Keypair.generate();

                    // Pass the payer key as the prepared order.
                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: preparedOrder.publicKey,
                        },
                        {
                            amountIn: new BN(amountIn.toString()),
                            targetChain: foreignChain,
                            relayOptions: {
                                gasDropoff: gasDropoff,
                                maxRelayerFee: new BN(maxRelayerFee),
                            },
                            recipient: foreignRecipientAddress,
                            encodedOutputToken: Buffer.from(encodeOutputToken({ type: "Usdc" })),
                            payload: null,
                        },
                    );

                    await expectIxErr(
                        connection,
                        [ix],
                        [payer, preparedOrder],
                        "ExceedsMaxRelayingFee",
                    );
                });

                it("Cannot Initiate Transfer (Relaying Disabled)", async function () {
                    const amountIn = 6900000000n;
                    const gasDropoff = 100000;
                    const maxRelayerFee = 9999999999999;

                    // Update the relay parameters to disable relaying.
                    await updateRelayParamsForTest(
                        swapLayer,
                        foreignChain,
                        {
                            ...relayParamsForTest,
                            baseFee: U32_MAX,
                        },
                        feeUpdater,
                    );

                    const preparedOrder = Keypair.generate();

                    // Pass the payer key as the prepared order.
                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: preparedOrder.publicKey,
                        },
                        {
                            amountIn: new BN(amountIn.toString()),
                            targetChain: foreignChain,
                            relayOptions: {
                                gasDropoff: gasDropoff,
                                maxRelayerFee: new BN(maxRelayerFee),
                            },
                            recipient: foreignRecipientAddress,
                            encodedOutputToken: Buffer.from(encodeOutputToken({ type: "Usdc" })),
                            payload: null,
                        },
                    );

                    await expectIxErr(connection, [ix], [payer, preparedOrder], "RelayingDisabled");

                    // Set the relay parameters back to the original.
                    await updateRelayParamsForTest(
                        swapLayer,
                        foreignChain,
                        relayParamsForTest,
                        feeUpdater,
                    );
                });

                it("Cannot Initiate Transfer (Invalid Gas Dropoff)", async function () {
                    const amountIn = 6900000000n;
                    const maxRelayerFee = 9999999999999;

                    // Set the gas dropoff to a value larger than the max.
                    const gasDropoff = relayParamsForTest.maxGasDropoff + 1;

                    const preparedOrder = Keypair.generate();

                    // Pass the payer key as the prepared order.
                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: preparedOrder.publicKey,
                        },
                        {
                            amountIn: new BN(amountIn.toString()),
                            targetChain: foreignChain,
                            relayOptions: {
                                gasDropoff: gasDropoff,
                                maxRelayerFee: new BN(maxRelayerFee),
                            },
                            recipient: foreignRecipientAddress,
                            encodedOutputToken: Buffer.from(encodeOutputToken({ type: "Usdc" })),
                            payload: null,
                        },
                    );

                    await expectIxErr(
                        connection,
                        [ix],
                        [payer, preparedOrder],
                        "InvalidGasDropoff",
                    );
                });

                it("Initiate Transfer With Gas Dropoff", async function () {
                    const amountIn = 6900000000n;
                    const gasDropoff = 100000;
                    const maxRelayerFee = 9999999999999;

                    // Fetch peer data.
                    const peer = await swapLayer.fetchPeer(foreignChain);

                    const expectedRelayerFee = calculateRelayerFee(
                        peer.relayParams,
                        denormalizeGasDropOff(gasDropoff),
                        { none: {} },
                        0,
                    );

                    // Balance check.
                    const payerToken = await splToken.getOrCreateAssociatedTokenAccount(
                        connection,
                        payer,
                        USDC_MINT_ADDRESS,
                        payer.publicKey,
                    );
                    const payerBefore = await getUsdcAtaBalance(connection, payer.publicKey);

                    const preparedOrder = Keypair.generate();

                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: preparedOrder.publicKey,
                        },
                        {
                            amountIn: new BN(amountIn.toString()),
                            targetChain: foreignChain,
                            relayOptions: {
                                gasDropoff: gasDropoff,
                                maxRelayerFee: new BN(maxRelayerFee),
                            },
                            recipient: foreignRecipientAddress,
                            encodedOutputToken: Buffer.from(encodeOutputToken({ type: "Usdc" })),
                            payload: null,
                        },
                    );

                    await expectIxOk(connection, [ix], [payer, preparedOrder]);

                    // Balance check.
                    const payerAfter = await getUsdcAtaBalance(connection, payer.publicKey);
                    expect(payerAfter).to.equal(payerBefore - amountIn - expectedRelayerFee);

                    // Verify the relevant information in the prepared order.
                    const preparedOrderData = await tokenRouter.fetchPreparedOrder(
                        preparedOrder.publicKey,
                    );

                    const {
                        info: { preparedCustodyTokenBump },
                    } = preparedOrderData;

                    hackedExpectDeepEqual(
                        preparedOrderData,
                        new PreparedOrder(
                            {
                                orderSender: payer.publicKey,
                                preparedBy: payer.publicKey,
                                orderType: {
                                    market: {
                                        minAmountOut: null,
                                    },
                                },
                                srcToken: payerToken.address,
                                refundToken: payerToken.address,
                                targetChain: foreignChain,
                                redeemer: foreignSwapLayerAddress,
                                preparedCustodyTokenBump,
                            },
                            Buffer.from(
                                encodeSwapLayerMessage({
                                    recipient: new UniversalAddress(
                                        Uint8Array.from(foreignRecipientAddress),
                                    ),
                                    redeemMode: {
                                        mode: "Relay",
                                        gasDropoff,
                                        relayingFee: expectedRelayerFee,
                                    },
                                    outputToken: { type: "Usdc" },
                                }),
                            ),
                        ),
                    );

                    // Verify the prepared custody token balance.
                    const { amount: preparedCustodyTokenBalance } = await splToken.getAccount(
                        connection,
                        tokenRouter.preparedCustodyTokenAddress(preparedOrder.publicKey),
                    );
                    expect(preparedCustodyTokenBalance).equals(amountIn + expectedRelayerFee);
                });

                it("Initiate Transfer Without Gas Dropoff", async function () {
                    const amountIn = 6900000000n;
                    const gasDropoff = 0;
                    const maxRelayerFee = 9999999999999;

                    // Fetch peer data.
                    const peer = await swapLayer.fetchPeer(foreignChain);

                    const expectedRelayerFee = calculateRelayerFee(
                        peer.relayParams,
                        denormalizeGasDropOff(gasDropoff),
                        { none: {} },
                        0,
                    );

                    // Balance check.
                    const payerToken = await splToken.getOrCreateAssociatedTokenAccount(
                        connection,
                        payer,
                        USDC_MINT_ADDRESS,
                        payer.publicKey,
                    );
                    const payerBefore = await getUsdcAtaBalance(connection, payer.publicKey);

                    const preparedOrder = Keypair.generate();

                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: preparedOrder.publicKey,
                        },
                        {
                            amountIn: new BN(amountIn.toString()),
                            targetChain: foreignChain,
                            relayOptions: {
                                gasDropoff: gasDropoff,
                                maxRelayerFee: new BN(maxRelayerFee),
                            },
                            recipient: foreignRecipientAddress,
                            encodedOutputToken: Buffer.from(encodeOutputToken({ type: "Usdc" })),
                            payload: null,
                        },
                    );

                    await expectIxOk(connection, [ix], [payer, preparedOrder]);

                    // Balance check.
                    const payerAfter = await getUsdcAtaBalance(connection, payer.publicKey);
                    expect(payerAfter).to.equal(payerBefore - amountIn - expectedRelayerFee);

                    // Verify the relevant information in the prepared order.
                    const preparedOrderData = await tokenRouter.fetchPreparedOrder(
                        preparedOrder.publicKey,
                    );

                    const {
                        info: { preparedCustodyTokenBump },
                    } = preparedOrderData;

                    hackedExpectDeepEqual(
                        preparedOrderData,
                        new PreparedOrder(
                            {
                                orderSender: payer.publicKey,
                                preparedBy: payer.publicKey,
                                orderType: {
                                    market: {
                                        minAmountOut: null,
                                    },
                                },
                                srcToken: payerToken.address,
                                refundToken: payerToken.address,
                                targetChain: foreignChain,
                                redeemer: foreignSwapLayerAddress,
                                preparedCustodyTokenBump,
                            },
                            Buffer.from(
                                encodeSwapLayerMessage({
                                    recipient: new UniversalAddress(
                                        Uint8Array.from(foreignRecipientAddress),
                                    ),
                                    redeemMode: {
                                        mode: "Relay",
                                        gasDropoff,
                                        relayingFee: expectedRelayerFee,
                                    },
                                    outputToken: { type: "Usdc" },
                                }),
                            ),
                        ),
                    );

                    // Verify the prepared custody token balance.
                    const { amount: preparedCustodyTokenBalance } = await splToken.getAccount(
                        connection,
                        tokenRouter.preparedCustodyTokenAddress(preparedOrder.publicKey),
                    );
                    expect(preparedCustodyTokenBalance).equals(amountIn + expectedRelayerFee);
                });
            });

            describe("Inbound", function () {
                it("Cannot Complete Transfer (Invalid Fee Recipient)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(payer.publicKey.toString(), "base58"),
                            redeemMode: {
                                mode: "Relay",
                                gasDropoff: 0,
                                relayingFee: 6900n,
                            },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    // Pass the payer token to as the fee recipient token.
                    const payerToken = await splToken.getOrCreateAssociatedTokenAccount(
                        connection,
                        payer,
                        USDC_MINT_ADDRESS,
                        payer.publicKey,
                    );

                    const transferIx = await swapLayer.completeTransferRelayIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: payer.publicKey,
                            feeRecipientToken: payerToken.address,
                        },
                        foreignChain,
                    );

                    await expectIxErr(
                        connection,
                        [transferIx],
                        [payer],
                        "fee_recipient_token. Error Code: ConstraintAddress",
                    );
                });

                it("Cannot Complete Transfer (Peer Doesn't Exist)", async function () {
                    const invalidChain = 69;

                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(payer.publicKey.toString(), "base58"),
                            redeemMode: {
                                mode: "Relay",
                                gasDropoff: 0,
                                relayingFee: 6900n,
                            },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    const transferIx = await swapLayer.completeTransferRelayIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: payer.publicKey,
                        },
                        invalidChain as ChainId,
                    );

                    await expectIxErr(connection, [transferIx], [payer], "AccountNotInitialized");
                });

                it("Cannot Complete Transfer (Invalid Swap Message)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        Buffer.from("invalid message"),
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    const transferIx = await swapLayer.completeTransferRelayIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: payer.publicKey,
                        },
                        foreignChain,
                    );

                    await expectIxErr(connection, [transferIx], [payer], "InvalidSwapMessage");
                });

                it("Cannot Complete Transfer (Invalid Peer)", async function () {
                    // Create a valid transfer but from the wrong sender.
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        Array.from(
                            Buffer.alloc(
                                32,
                                "00000000000000000000000000000000000000000000000000000000deadbeef",
                                "hex",
                            ),
                        ), // Invalid Address.
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(payer.publicKey.toString(), "base58"),
                            redeemMode: {
                                mode: "Relay",
                                gasDropoff: 0,
                                relayingFee: 6900n,
                            },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    const transferIx = await swapLayer.completeTransferRelayIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: payer.publicKey,
                        },
                        foreignChain,
                    );

                    await expectIxErr(connection, [transferIx], [payer], "InvalidPeer");
                });

                it("Cannot Complete Transfer (Invalid Output Token)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(payer.publicKey.toString(), "base58"),
                            redeemMode: {
                                mode: "Relay",
                                gasDropoff: 0,
                                relayingFee: 6900n,
                            },
                            outputToken: {
                                type: "Gas",
                                swap: {
                                    deadline: 0,
                                    limitAmount: 0n,
                                    type: {
                                        id: "JupiterV6",
                                        dexProgramId: { isSome: false },
                                    },
                                },
                            },
                        }),
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    const transferIx = await swapLayer.completeTransferRelayIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: payer.publicKey,
                        },
                        foreignChain,
                    );

                    await expectIxErr(connection, [transferIx], [payer], "InvalidOutputToken");
                });

                it("Cannot Complete Transfer (Invalid Recipient)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(payer.publicKey.toString(), "base58"),
                            redeemMode: {
                                mode: "Relay",
                                gasDropoff: 0,
                                relayingFee: 6900n,
                            },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    const transferIx = await swapLayer.completeTransferRelayIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: feeRecipient, // Invalid recipient
                        },
                        foreignChain,
                    );

                    await expectIxErr(connection, [transferIx], [payer], "InvalidRecipient");
                });

                it("Cannot Complete Transfer (Invalid Redeem Mode)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(payer.publicKey.toString(), "base58"),
                            redeemMode: { mode: "Direct" },
                            outputToken: { type: "Usdc" },
                        }), // Encode Direct instead of Relay.
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    const transferIx = await swapLayer.completeTransferRelayIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: payer.publicKey,
                        },
                        foreignChain,
                    );

                    await expectIxErr(connection, [transferIx], [payer], "InvalidRedeemMode");
                });

                it("Complete Transfer (Payer == Recipient)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(payer.publicKey.toString(), "base58"),
                            redeemMode: {
                                mode: "Relay",
                                gasDropoff: 0,
                                relayingFee: 6900n,
                            },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa, message } = result!;

                    const preparedFill = tokenRouter.preparedFillAddress(vaa);
                    const beneficiary = Keypair.generate();

                    // Balance check.
                    const recipientBefore = await getUsdcAtaBalance(connection, payer.publicKey);
                    const payerLamportBefore = await connection.getBalance(payer.publicKey);
                    const feeRecipientBefore = await getUsdcAtaBalance(connection, feeRecipient);

                    const transferIx = await swapLayer.completeTransferRelayIx(
                        {
                            payer: payer.publicKey,
                            beneficiary: beneficiary.publicKey,
                            preparedFill,
                            recipient: payer.publicKey,
                        },
                        foreignChain,
                    );

                    await expectIxOk(connection, [transferIx], [payer]);

                    // Balance check.
                    const recipientAfter = await getUsdcAtaBalance(connection, payer.publicKey);
                    const payerLamportAfter = await connection.getBalance(payer.publicKey);
                    const feeRecipientAfter = await getUsdcAtaBalance(connection, feeRecipient);

                    expect(recipientAfter).to.equal(
                        recipientBefore + message.deposit!.header.amount,
                    );
                    expect(payerLamportAfter).to.be.lessThan(payerLamportBefore);
                    expect(feeRecipientAfter).to.equal(feeRecipientBefore);
                });

                it("Complete Transfer With Gas Dropoff", async function () {
                    const relayerFee = 1000000n;
                    const gasAmountDenorm = 690000000;

                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(
                                recipient.publicKey.toString(),
                                "base58",
                            ),
                            redeemMode: {
                                mode: "Relay",
                                gasDropoff: gasAmountDenorm / 1000,
                                relayingFee: relayerFee,
                            },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa, message } = result!;

                    const preparedFill = tokenRouter.preparedFillAddress(vaa);
                    const beneficiary = Keypair.generate();

                    // Balance check.
                    const recipientBefore = await getUsdcAtaBalance(
                        connection,
                        recipient.publicKey,
                    );
                    const recipientLamportBefore = await connection.getBalance(recipient.publicKey);
                    const payerLamportBefore = await connection.getBalance(payer.publicKey);
                    const feeRecipientBefore = await getUsdcAtaBalance(connection, feeRecipient);

                    const transferIx = await swapLayer.completeTransferRelayIx(
                        {
                            payer: payer.publicKey,
                            beneficiary: beneficiary.publicKey,
                            preparedFill,
                            recipient: recipient.publicKey,
                        },
                        foreignChain,
                    );

                    await expectIxOk(connection, [transferIx], [payer]);

                    // Balance check.
                    const recipientAfter = await getUsdcAtaBalance(connection, recipient.publicKey);
                    const recipientLamportAfter = await connection.getBalance(recipient.publicKey);
                    const payerLamportAfter = await connection.getBalance(payer.publicKey);
                    const feeRecipientAfter = await getUsdcAtaBalance(connection, feeRecipient);

                    expect(recipientAfter - recipientBefore).to.equal(
                        message.deposit!.header.amount - relayerFee,
                    );
                    expect(recipientLamportAfter - recipientLamportBefore).to.equal(
                        Number(gasAmountDenorm),
                    );
                    expect(payerLamportAfter).to.be.lessThan(
                        payerLamportBefore - Number(gasAmountDenorm),
                    );
                    expect(feeRecipientAfter).to.equal(feeRecipientBefore + relayerFee);
                });

                it("Complete Transfer Without Gas Dropoff", async function () {
                    const relayerFee = 1000000n;
                    const gasAmount = 0;

                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(
                                recipient.publicKey.toString(),
                                "base58",
                            ),
                            redeemMode: {
                                mode: "Relay",
                                gasDropoff: gasAmount,
                                relayingFee: relayerFee,
                            },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa, message } = result!;

                    const preparedFill = tokenRouter.preparedFillAddress(vaa);
                    const beneficiary = Keypair.generate();

                    // Balance check.
                    const recipientBefore = await getUsdcAtaBalance(
                        connection,
                        recipient.publicKey,
                    );
                    const recipientLamportBefore = await connection.getBalance(recipient.publicKey);
                    const payerLamportBefore = await connection.getBalance(payer.publicKey);
                    const feeRecipientBefore = await getUsdcAtaBalance(connection, feeRecipient);

                    const transferIx = await swapLayer.completeTransferRelayIx(
                        {
                            payer: payer.publicKey,
                            beneficiary: beneficiary.publicKey,
                            preparedFill,
                            recipient: recipient.publicKey,
                        },
                        foreignChain,
                    );

                    await expectIxOk(connection, [transferIx], [payer]);

                    // Balance check.
                    const recipientAfter = await getUsdcAtaBalance(connection, recipient.publicKey);
                    const recipientLamportAfter = await connection.getBalance(recipient.publicKey);
                    const payerLamportAfter = await connection.getBalance(payer.publicKey);
                    const feeRecipientAfter = await getUsdcAtaBalance(connection, feeRecipient);

                    expect(recipientAfter - recipientBefore).to.equal(
                        message.deposit!.header.amount - relayerFee,
                    );
                    expect(recipientLamportAfter - recipientLamportBefore).to.equal(
                        Number(gasAmount),
                    );
                    expect(payerLamportAfter).to.be.lessThan(
                        payerLamportBefore - Number(gasAmount),
                    );
                    expect(feeRecipientAfter).to.equal(feeRecipientBefore + relayerFee);
                });
            });
        });

        describe("USDC Transfer (Direct)", function () {
            describe("Outbound", function () {
                it("Initiate Transfer", async function () {
                    const amountIn = 6900000000n;

                    // Balance check.
                    const payerToken = await splToken.getOrCreateAssociatedTokenAccount(
                        connection,
                        payer,
                        USDC_MINT_ADDRESS,
                        payer.publicKey,
                    );
                    const payerBefore = await getUsdcAtaBalance(connection, payer.publicKey);

                    const preparedOrder = Keypair.generate();

                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: preparedOrder.publicKey,
                        },
                        {
                            amountIn: new BN(amountIn.toString()),
                            targetChain: foreignChain,
                            relayOptions: null,
                            recipient: foreignRecipientAddress,
                            encodedOutputToken: Buffer.from(encodeOutputToken({ type: "Usdc" })),
                            payload: null,
                        },
                    );

                    await expectIxOk(connection, [ix], [payer, preparedOrder]);

                    // Balance check.
                    const payerAfter = await getUsdcAtaBalance(connection, payer.publicKey);
                    expect(payerAfter).to.equal(payerBefore - amountIn);

                    // Verify the relevant information in the prepared order.
                    const preparedOrderData = await tokenRouter.fetchPreparedOrder(
                        preparedOrder.publicKey,
                    );

                    const {
                        info: { preparedCustodyTokenBump },
                    } = preparedOrderData;

                    hackedExpectDeepEqual(
                        preparedOrderData,
                        new PreparedOrder(
                            {
                                orderSender: payer.publicKey,
                                preparedBy: payer.publicKey,
                                orderType: {
                                    market: {
                                        minAmountOut: null,
                                    },
                                },
                                srcToken: payerToken.address,
                                refundToken: payerToken.address,
                                targetChain: foreignChain,
                                redeemer: foreignSwapLayerAddress,
                                preparedCustodyTokenBump,
                            },
                            Buffer.from(
                                encodeSwapLayerMessage({
                                    recipient: new UniversalAddress(
                                        Uint8Array.from(foreignRecipientAddress),
                                    ),
                                    redeemMode: { mode: "Direct" },
                                    outputToken: { type: "Usdc" },
                                }),
                            ),
                        ),
                    );

                    // Verify the prepared custody token balance.
                    const { amount: preparedCustodyTokenBalance } = await splToken.getAccount(
                        connection,
                        tokenRouter.preparedCustodyTokenAddress(preparedOrder.publicKey),
                    );
                    expect(preparedCustodyTokenBalance).equals(amountIn);
                });
            });

            describe("Inbound", function () {
                it("Cannot Complete Transfer (Invalid Swap Message)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        Buffer.from("invalid message"),
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    const transferIx = await swapLayer.completeTransferDirectIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: recipient.publicKey,
                        },
                        foreignChain,
                    );

                    await expectIxErr(connection, [transferIx], [payer], "InvalidSwapMessage");
                });

                it("Cannot Complete Transfer (Invalid Peer)", async function () {
                    // Create a valid transfer but from the wrong sender.
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        Array.from(
                            Buffer.alloc(
                                32,
                                "00000000000000000000000000000000000000000000000000000000deadbeef",
                                "hex",
                            ),
                        ), // Invalid Address.,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(
                                recipient.publicKey.toString(),
                                "base58",
                            ),
                            redeemMode: { mode: "Direct" },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    const transferIx = await swapLayer.completeTransferDirectIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: recipient.publicKey,
                        },
                        foreignChain,
                    );

                    await expectIxErr(connection, [transferIx], [payer], "InvalidPeer");
                });

                it("Cannot Complete Transfer (Peer Doesn't Exist)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(
                                recipient.publicKey.toString(),
                                "base58",
                            ),
                            redeemMode: { mode: "Direct" },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    const transferIx = await swapLayer.completeTransferDirectIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: recipient.publicKey,
                        },
                        69 as ChainId, // Invalid chain.
                    );

                    await expectIxErr(connection, [transferIx], [payer], "AccountNotInitialized");
                });

                it("Cannot Complete Transfer (Invalid Recipient)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(
                                recipient.publicKey.toString(),
                                "base58",
                            ),
                            redeemMode: { mode: "Direct" },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    const transferIx = await swapLayer.completeTransferDirectIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: payer.publicKey, // Pass invalid recipient.
                        },
                        foreignChain,
                    );

                    await expectIxErr(connection, [transferIx], [payer], "InvalidRecipient");
                });

                it("Cannot Complete Transfer (Invalid Output Token)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(
                                recipient.publicKey.toString(),
                                "base58",
                            ),
                            redeemMode: {
                                mode: "Direct",
                            },
                            outputToken: {
                                type: "Gas",
                                swap: {
                                    deadline: 0,
                                    limitAmount: 0n,
                                    type: {
                                        id: "JupiterV6",
                                        dexProgramId: { isSome: false },
                                    },
                                },
                            },
                        }),
                    );
                    const { vaa } = result!;
                    const preparedFill = tokenRouter.preparedFillAddress(vaa);

                    const transferIx = await swapLayer.completeTransferDirectIx(
                        {
                            payer: payer.publicKey,
                            preparedFill,
                            recipient: recipient.publicKey,
                        },
                        foreignChain,
                    );

                    await expectIxErr(connection, [transferIx], [payer], "InvalidOutputToken");
                });

                it("Complete Transfer (Recipient Not Payer)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(
                                recipient.publicKey.toString(),
                                "base58",
                            ),
                            redeemMode: { mode: "Direct" },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa, message } = result!;

                    const preparedFill = tokenRouter.preparedFillAddress(vaa);
                    const beneficiary = Keypair.generate();

                    // Balance check.
                    const recipientBefore = await getUsdcAtaBalance(
                        connection,
                        recipient.publicKey,
                    );
                    const beneficiaryBefore = await connection.getBalance(beneficiary.publicKey);

                    const transferIx = await swapLayer.completeTransferDirectIx(
                        {
                            payer: payer.publicKey,
                            beneficiary: beneficiary.publicKey,
                            preparedFill,
                            recipient: recipient.publicKey,
                        },
                        foreignChain,
                    );

                    await expectIxOk(connection, [transferIx], [payer]);

                    // Balance check.
                    const recipientAfter = await getUsdcAtaBalance(connection, recipient.publicKey);
                    const beneficiaryAfter = await connection.getBalance(beneficiary.publicKey);

                    expect(recipientAfter).to.equal(
                        recipientBefore + message.deposit!.header.amount,
                    );
                    expect(beneficiaryAfter).to.be.greaterThan(beneficiaryBefore);
                });

                it("Complete Transfer (Recipient Is Payer)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(payer.publicKey.toString(), "base58"),
                            redeemMode: { mode: "Direct" },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa, message } = result!;

                    const preparedFill = tokenRouter.preparedFillAddress(vaa);
                    const beneficiary = Keypair.generate();

                    // Balance check.
                    const recipientBefore = await getUsdcAtaBalance(connection, payer.publicKey);
                    const beneficiaryBefore = await connection.getBalance(beneficiary.publicKey);

                    const transferIx = await swapLayer.completeTransferDirectIx(
                        {
                            payer: payer.publicKey,
                            beneficiary: beneficiary.publicKey,
                            preparedFill,
                        },
                        foreignChain,
                    );

                    await expectIxOk(connection, [transferIx], [payer]);

                    // Balance check.
                    const recipientAfter = await getUsdcAtaBalance(connection, payer.publicKey);
                    const beneficiaryAfter = await connection.getBalance(beneficiary.publicKey);

                    expect(recipientAfter).to.equal(
                        recipientBefore + message.deposit!.header.amount,
                    );
                    expect(beneficiaryAfter).to.be.greaterThan(beneficiaryBefore);
                });
            });
        });

        describe("USDC Transfer (Payload)", function () {
            describe("Outbound", function () {
                it("Initiate Transfer", async function () {
                    const amountIn = 6900000000n;
                    const payload = Buffer.from("Insert payload here");

                    // Balance check.
                    const payerToken = await splToken.getOrCreateAssociatedTokenAccount(
                        connection,
                        payer,
                        USDC_MINT_ADDRESS,
                        payer.publicKey,
                    );
                    const payerBefore = await getUsdcAtaBalance(connection, payer.publicKey);

                    const preparedOrder = Keypair.generate();

                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: preparedOrder.publicKey,
                        },
                        {
                            amountIn: new BN(amountIn.toString()),
                            targetChain: foreignChain,
                            relayOptions: null,
                            recipient: foreignRecipientAddress,
                            encodedOutputToken: Buffer.from(encodeOutputToken({ type: "Usdc" })),
                            payload,
                        },
                    );

                    await expectIxOk(connection, [ix], [payer, preparedOrder]);

                    // Balance check.
                    const payerAfter = await getUsdcAtaBalance(connection, payer.publicKey);
                    expect(payerAfter).to.equal(payerBefore - amountIn);

                    // Verify the relevant information in the prepared order.
                    const preparedOrderData = await tokenRouter.fetchPreparedOrder(
                        preparedOrder.publicKey,
                    );

                    const {
                        info: { preparedCustodyTokenBump },
                    } = preparedOrderData;

                    hackedExpectDeepEqual(
                        preparedOrderData,
                        new PreparedOrder(
                            {
                                orderSender: payer.publicKey,
                                preparedBy: payer.publicKey,
                                orderType: {
                                    market: {
                                        minAmountOut: null,
                                    },
                                },
                                srcToken: payerToken.address,
                                refundToken: payerToken.address,
                                targetChain: foreignChain,
                                redeemer: foreignSwapLayerAddress,
                                preparedCustodyTokenBump,
                            },
                            Buffer.from(
                                encodeSwapLayerMessage({
                                    recipient: new UniversalAddress(
                                        Uint8Array.from(foreignRecipientAddress),
                                    ),
                                    redeemMode: { mode: "Payload", payload },
                                    outputToken: { type: "Usdc" },
                                }),
                            ),
                        ),
                    );

                    // Verify the prepared custody token balance.
                    const { amount: preparedCustodyTokenBalance } = await splToken.getAccount(
                        connection,
                        tokenRouter.preparedCustodyTokenAddress(preparedOrder.publicKey),
                    );
                    expect(preparedCustodyTokenBalance).equals(amountIn);
                });
            });

            describe("Inbound", function () {
                const localVariables = {};

                it("Stage Inbound Transfer", async function () {
                    const payload = Buffer.from("Insert payload here");

                    const result = await createAndRedeemCctpFillForTest(
                        connection,
                        tokenRouter,
                        swapLayer,
                        tokenRouterLkupTable,
                        payer,
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        foreignSwapLayerAddress,
                        wormholeSequence,
                        encodeSwapLayerMessage({
                            recipient: new UniversalAddress(
                                recipient.publicKey.toString(),
                                "base58",
                            ),
                            redeemMode: { mode: "Payload", payload },
                            outputToken: { type: "Usdc" },
                        }),
                    );
                    const { vaa, message } = result!;

                    const preparedFill = tokenRouter.preparedFillAddress(vaa);
                    const beneficiary = Keypair.generate();

                    const transferIx = await swapLayer.completeTransferPayloadIx(
                        {
                            payer: payer.publicKey,
                            beneficiary: beneficiary.publicKey,
                            preparedFill,
                        },
                        foreignChain,
                    );

                    await expectIxOk(connection, [transferIx], [payer]);

                    // Balance check.
                    const stagedInbound = swapLayer.stagedInboundAddress(preparedFill);
                    const stagedInboundTokenAddress =
                        swapLayer.stagedInboundTokenAddress(stagedInbound);

                    const { amount: balanceAfter } = await splToken.getAccount(
                        connection,
                        stagedInboundTokenAddress,
                    );
                    expect(balanceAfter).to.equal(message.deposit!.header.amount);

                    // State check.
                    const stagedInboundData = await swapLayer.fetchStagedInbound(stagedInbound);
                    hackedExpectDeepEqual(
                        stagedInboundData,
                        new StagedInbound(
                            {
                                preparedFill,
                                bump: stagedInboundData.seeds.bump,
                            },
                            {
                                stagedCustodyTokenBump:
                                    stagedInboundData.info.stagedCustodyTokenBump,
                                stagedBy: payer.publicKey,
                                sourceChain: foreignChain,
                                recipient: recipient.publicKey,
                                isNative: false,
                            },
                            payload,
                        ),
                    );

                    localVariables["stagedInbound"] = stagedInbound;
                });

                it("Release Inbound", async function () {
                    const stagedInbound = localVariables["stagedInbound"];
                    const beneficiary = Keypair.generate();
                    const dstTokenOwner = Keypair.generate();

                    const dstToken = splToken.getAssociatedTokenAddressSync(
                        USDC_MINT_ADDRESS,
                        dstTokenOwner.publicKey,
                    );

                    await expectIxOk(
                        connection,
                        [
                            splToken.createAssociatedTokenAccountInstruction(
                                payer.publicKey,
                                dstToken,
                                dstTokenOwner.publicKey,
                                USDC_MINT_ADDRESS,
                            ),
                        ],
                        [payer],
                    );

                    const expectedLamports = await connection
                        .getAccountInfo(stagedInbound)
                        .then((info) => info!.lamports);
                    const custodyToken = swapLayer.stagedInboundTokenAddress(stagedInbound);
                    const { amount: stagedTokenBalance } = await splToken.getAccount(
                        connection,
                        custodyToken,
                    );
                    const expectedCustodyTokenLamports = await connection
                        .getAccountInfo(custodyToken)
                        .then((info) => info!.lamports);

                    const consumeIx = await swapLayer.releaseInboundIx({
                        recipient: recipient.publicKey,
                        beneficiary: beneficiary.publicKey,
                        stagedInbound,
                        dstToken: dstToken,
                    });

                    await expectIxOk(connection, [consumeIx], [recipient]);

                    // Verify that accounts were closed.
                    {
                        const accInfo = await connection.getAccountInfo(stagedInbound);
                        expect(accInfo).is.null;
                    }
                    {
                        const accInfo = await connection.getAccountInfo(custodyToken);
                        expect(accInfo).is.null;
                    }

                    const { amount: dstTokenBalance } = await splToken.getAccount(
                        connection,
                        dstToken,
                    );
                    expect(dstTokenBalance).equals(stagedTokenBalance);

                    const beneficiaryBalance = await connection.getBalance(beneficiary.publicKey);
                    expect(beneficiaryBalance).equals(
                        expectedLamports + expectedCustodyTokenLamports,
                    );
                });
            });
        });
    });
});

async function createAndRedeemCctpFillForTest(
    connection: Connection,
    tokenRouter: tokenRouterSdk.TokenRouterProgram,
    swapLayer: SwapLayerProgram,
    tokenRouterLkupTable: PublicKey,
    payer: Keypair,
    cctpNonce: bigint,
    foreignChain: number,
    foreignEndpointAddress: number[],
    orderSender: number[],
    wormholeSequence: bigint,
    redeemerMessage: Buffer | Uint8Array,
): Promise<null | { vaa: PublicKey; message: LiquidityLayerMessage }> {
    const encodedMintRecipient = Array.from(tokenRouter.cctpMintRecipientAddress().toBuffer());
    const sourceCctpDomain = 0;
    const amount = 6900000000n;
    const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
    const redeemer = swapLayer.custodianAddress();

    // Concoct a Circle message.
    const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
        await craftCctpTokenBurnMessage(
            tokenRouter,
            sourceCctpDomain,
            cctpNonce,
            encodedMintRecipient,
            amount,
            burnSource,
        );

    const message = new LiquidityLayerMessage({
        deposit: new LiquidityLayerDeposit(
            {
                tokenAddress: burnMessage.burnTokenAddress,
                amount,
                sourceCctpDomain,
                destinationCctpDomain,
                cctpNonce,
                burnSource,
                mintRecipient: encodedMintRecipient,
            },
            {
                fill: {
                    sourceChain: foreignChain as ChainId,
                    orderSender,
                    redeemer: Array.from(redeemer.toBuffer()),
                    redeemerMessage: Buffer.from(redeemerMessage),
                },
            },
        ),
    });

    const vaa = await postLiquidityLayerVaa(
        connection,
        payer,
        MOCK_GUARDIANS,
        foreignEndpointAddress,
        wormholeSequence++,
        message,
        { sourceChain: "Ethereum" },
    );

    const ix = await tokenRouter.redeemCctpFillIx(
        {
            payer: payer.publicKey,
            vaa,
        },
        {
            encodedCctpMessage,
            cctpAttestation,
        },
    );

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 300_000,
    });

    const { value: lookupTableAccount } = await connection.getAddressLookupTable(
        tokenRouterLkupTable,
    );

    await expectIxOk(connection, [computeIx, ix], [payer], {
        addressLookupTableAccounts: [lookupTableAccount!],
    });

    return { vaa, message };
}

async function craftCctpTokenBurnMessage(
    tokenRouter: tokenRouterSdk.TokenRouterProgram,
    sourceCctpDomain: number,
    cctpNonce: bigint,
    encodedMintRecipient: number[],
    amount: bigint,
    burnSource: number[],
    overrides: { destinationCctpDomain?: number } = {},
) {
    const { destinationCctpDomain: inputDestinationCctpDomain } = overrides;

    const messageTransmitterProgram = tokenRouter.messageTransmitterProgram();
    const { version, localDomain } = await messageTransmitterProgram.fetchMessageTransmitterConfig(
        messageTransmitterProgram.messageTransmitterConfigAddress(),
    );
    const destinationCctpDomain = inputDestinationCctpDomain ?? localDomain;

    const tokenMessengerMinterProgram = tokenRouter.tokenMessengerMinterProgram();
    const { tokenMessenger: sourceTokenMessenger } =
        await tokenMessengerMinterProgram.fetchRemoteTokenMessenger(
            tokenMessengerMinterProgram.remoteTokenMessengerAddress(sourceCctpDomain),
        );

    const burnMessage = new CctpTokenBurnMessage(
        {
            version,
            sourceDomain: sourceCctpDomain,
            destinationDomain: destinationCctpDomain,
            nonce: cctpNonce,
            sender: sourceTokenMessenger,
            recipient: Array.from(tokenMessengerMinterProgram.ID.toBuffer()), // targetTokenMessenger
            targetCaller: Array.from(tokenRouter.custodianAddress().toBuffer()), // targetCaller
        },
        0,
        Array.from(tryNativeToUint8Array(ETHEREUM_USDC_ADDRESS, "Ethereum")), // sourceTokenAddress
        encodedMintRecipient,
        amount,
        burnSource,
    );

    const encodedCctpMessage = burnMessage.encode();
    const cctpAttestation = new CircleAttester().createAttestation(encodedCctpMessage);

    return {
        destinationCctpDomain,
        burnMessage,
        encodedCctpMessage,
        cctpAttestation,
    };
}

async function updateRelayParamsForTest(
    swapLayer: SwapLayerProgram,
    foreignChain: ChainId,
    relayParams: RelayParams,
    feeUpdater: Keypair,
) {
    const ix = await swapLayer.updateRelayParamsIx(
        {
            feeUpdater: feeUpdater.publicKey,
        },
        {
            chain: foreignChain,
            relayParams,
        },
    );

    await expectIxOk(swapLayer.program.provider.connection, [ix], [feeUpdater]);
}
