import { BN } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import {
    ComputeBudgetProgram,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import { CctpTokenBurnMessage } from "@wormhole-foundation/example-liquidity-layer-solana/cctp";
import {
    LiquidityLayerDeposit,
    LiquidityLayerMessage,
    Uint64,
    uint64ToBN,
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
    toUniversalAddress,
} from "@wormhole-foundation/example-liquidity-layer-solana/testing";
import { PreparedOrder } from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter/state";
import { ChainId, toChain, toChainId } from "@wormhole-foundation/sdk-base";
import { UniversalAddress } from "@wormhole-foundation/sdk-definitions";
import { assert } from "chai";
import {
    AddPeerArgs,
    Custodian,
    OutputToken,
    Peer,
    RelayParams,
    StagedInbound,
    StagedOutbound,
    SwapLayerProgram,
    U32_MAX,
    UpdateRelayParametersArgs,
    calculateRelayerFee,
    denormalizeGasDropOff,
    encodeOutputToken,
    encodeSwapLayerMessage,
    localnet,
} from "../src/swapLayer";
import { FEE_UPDATER_KEYPAIR, REGISTERED_PEERS, createLut, tryNativeToUint8Array } from "./helpers";

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
    const tokenRouter = swapLayer.tokenRouterProgram();

    let tokenRouterLkupTable: PublicKey;

    const relayParamsForTest: RelayParams = {
        baseFee: 100000,
        nativeTokenPrice: uint64ToBN(1000000),
        maxGasDropoff: 500000,
        gasDropoffMargin: 10000,
        executionParams: {
            evm: {
                gasPrice: 100000,
                gasPriceMargin: 10000,
            },
        },
        swapTimeLimit: {
            fastLimit: 2,
            finalizedLimit: 2,
        },
    };

    let testCctpNonce = 2n ** 64n - 20n * 6400n;

    let wormholeSequence = 2000n;

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

                assert.deepEqual(
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
                nativeTokenPrice: uint64ToBN(4000000),
                maxGasDropoff: 200000,
                gasDropoffMargin: 50000,
                executionParams: {
                    evm: {
                        gasPrice: 500000,
                        gasPriceMargin: 50000,
                    },
                },
                swapTimeLimit: {
                    fastLimit: 420,
                    finalizedLimit: 690,
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
                    const { seeds } = peer;
                    assert.deepEqual(
                        peer,
                        new Peer(
                            { chain: foreignChain, bump: seeds.bump },
                            foreignRecipientAddress,
                            startParams,
                        ),
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
                    const { seeds } = peer;
                    assert.deepEqual(
                        peer,
                        new Peer(
                            { chain: foreignChain, bump: seeds.bump },
                            foreignSwapLayerAddress,
                            relayParamsForTest,
                        ),
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

                assert.deepEqual(custodianData.pendingOwner, owner.publicKey);
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
                    assert.deepEqual(custodianData.owner, owner.publicKey);
                    assert.deepEqual(custodianData.pendingOwner, null);
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
                assert.deepEqual(custodianData.pendingOwner, feeUpdater.publicKey);
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
                    assert.deepEqual(custodianData.owner, feeUpdater.publicKey);
                    assert.deepEqual(custodianData.pendingOwner, null);
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
                    assert.deepEqual(custodianData.owner, owner.publicKey);
                    assert.deepEqual(custodianData.pendingOwner, null);
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
                    assert.deepEqual(custodianData.pendingOwner, feeUpdater.publicKey);
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
                assert.isNull(custodianData.pendingOwner);
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
                assert.deepEqual(custodianData.ownerAssistant, feeUpdater.publicKey);

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
                assert.deepEqual(custodianData.feeRecipientToken, feeRecipientToken);

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
                assert.isTrue(localVariables.delete("ix"));

                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    newFeeRecipient,
                );

                await expectIxOk(connection, [ix], [ownerAssistant]);

                const custodianData = await swapLayer.fetchCustodian();
                assert.deepEqual(
                    custodianData.feeRecipientToken,
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
                assert.deepEqual(custodianData.feeRecipientToken, feeRecipientToken);
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
                swapTimeLimit: {
                    fastLimit: 2,
                    finalizedLimit: 69,
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
                assert.deepEqual(peer.relayParams, relayParams);
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
                assert.deepEqual(peer.relayParams, relayParams);
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
                assert.deepEqual(peer.relayParams, relayParams);
            });
        });
    });

    describe("Business Logic", function () {
        describe("Stage Outbound", function () {
            describe("Native", function () {
                it("Cannot Stage Outbound (Sender Required)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 690000n;
                    const [approveIx, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            stagedOutbound,
                            usdcRefundToken: splToken.getAssociatedTokenAddressSync(
                                swapLayer.usdcMint,
                                payer.publicKey,
                            ),
                            sender: null,
                        },
                        {
                            transferType: "native",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: null,
                            outputToken: null,
                        },
                    );
                    assert.isNull(approveIx);

                    await expectIxErr(
                        connection,
                        [ix],
                        [payer, stagedOutboundSigner],
                        "rror Code: SenderRequired",
                    );
                });

                it("Stage Outbound USDC (Direct)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const senderSigner = Keypair.generate();
                    const sender = senderSigner.publicKey;
                    await expectIxOk(
                        connection,
                        [
                            SystemProgram.transfer({
                                fromPubkey: payer.publicKey,
                                toPubkey: sender,
                                lamports: LAMPORTS_PER_SOL,
                            }),
                        ],
                        [payer],
                    );

                    const amountIn = 690000n;
                    const usdcRefundToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const [approveIx, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            stagedOutbound,
                            usdcRefundToken,
                            sender,
                        },
                        {
                            transferType: "native",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: null,
                            outputToken: null,
                        },
                    );
                    assert.isNull(approveIx);

                    const balanceBefore = await connection.getBalance(sender).then(BigInt);
                    await expectIxOk(connection, [ix], [payer, stagedOutboundSigner, senderSigner]);

                    const balanceAfter = await connection.getBalance(sender).then(BigInt);
                    assert.equal(balanceBefore - balanceAfter, amountIn);

                    const stagedOutboundData = await swapLayer.fetchStagedOutbound(stagedOutbound);
                    const { info } = stagedOutboundData;
                    assert.deepEqual(
                        stagedOutboundData,
                        new StagedOutbound(
                            {
                                custodyTokenBump: info.custodyTokenBump,
                                preparedBy: payer.publicKey,
                                sender,
                                targetChain: foreignChain,
                                recipient: foreignRecipientAddress,
                                usdcRefundToken,
                            },
                            { direct: {} },
                            Buffer.alloc(1),
                        ),
                    );
                });
            });

            describe("Program Transfer Authority", function () {
                it("Cannot Stage Outbound (Sender Token Required)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 690000n;
                    const ixs = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken: null,
                            stagedOutbound,
                            usdcRefundToken: splToken.getAssociatedTokenAddressSync(
                                swapLayer.usdcMint,
                                payer.publicKey,
                            ),
                        },
                        {
                            transferType: "programTransferAuthority",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: null,
                            outputToken: null,
                        },
                    );
                    assert.isNotNull(ixs[0]);

                    await expectIxErr(
                        connection,
                        [ixs[1]],
                        [payer, stagedOutboundSigner],
                        "Error Code: SenderTokenRequired",
                    );
                });

                it("Stage Outbound USDC (Direct)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 690000n;
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const ixs = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                        },
                        {
                            transferType: "programTransferAuthority",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: null,
                            outputToken: null,
                        },
                    );
                    assert.isNotNull(ixs[0]);

                    const { amount: balanceBefore } = await splToken.getAccount(
                        connection,
                        senderToken,
                    );
                    await expectIxOk(connection, ixs, [payer, stagedOutboundSigner]);

                    const { amount: balanceAfter } = await splToken.getAccount(
                        connection,
                        senderToken,
                    );
                    assert.equal(balanceBefore - balanceAfter, amountIn);

                    const stagedOutboundData = await swapLayer.fetchStagedOutbound(stagedOutbound);
                    const { info } = stagedOutboundData;
                    assert.deepEqual(
                        stagedOutboundData,
                        new StagedOutbound(
                            {
                                custodyTokenBump: info.custodyTokenBump,
                                preparedBy: payer.publicKey,
                                sender: payer.publicKey,
                                targetChain: foreignChain,
                                recipient: foreignRecipientAddress,
                                usdcRefundToken: senderToken,
                            },
                            { direct: {} },
                            Buffer.alloc(1),
                        ),
                    );
                });

                it("Stage Outbound USDC (Payload)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 690000n;
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const ixs = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                        },
                        {
                            transferType: "programTransferAuthority",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: {
                                payload: Buffer.from("All your base are belong to us."),
                            },
                            outputToken: null,
                        },
                    );
                    assert.isNotNull(ixs[0]);

                    const { amount: balanceBefore } = await splToken.getAccount(
                        connection,
                        senderToken,
                    );
                    await expectIxOk(connection, ixs, [payer, stagedOutboundSigner]);

                    const { amount: balanceAfter } = await splToken.getAccount(
                        connection,
                        senderToken,
                    );
                    assert.equal(balanceBefore - balanceAfter, amountIn);

                    const stagedOutboundData = await swapLayer.fetchStagedOutbound(stagedOutbound);
                    const { info } = stagedOutboundData;

                    assert.deepEqual(
                        stagedOutboundData,
                        new StagedOutbound(
                            {
                                custodyTokenBump: info.custodyTokenBump,
                                preparedBy: payer.publicKey,
                                sender: payer.publicKey,
                                targetChain: foreignChain,
                                recipient: foreignRecipientAddress,
                                usdcRefundToken: senderToken,
                            },
                            { payload: { "0": Buffer.from("All your base are belong to us.") } },
                            Buffer.alloc(1),
                        ),
                    );
                });
            });

            describe("Sender", function () {
                it("Cannot Stage Outbound (Existing Staged Outbound Account)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 690000n;
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const [approveIx, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                        },
                        {
                            transferType: "sender",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: null,
                            outputToken: null,
                        },
                    );
                    assert.isNull(approveIx);

                    await expectIxOk(connection, [ix], [payer, stagedOutboundSigner]);

                    await expectIxErr(
                        connection,
                        [ix],
                        [payer, stagedOutboundSigner],
                        `account Address { address: ${stagedOutboundSigner.publicKey.toString()}, base: None } already in use`,
                    );
                });

                it("Cannot Stage Outbound (Invalid Target Chain)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;
                    const baseChain = toChainId("Base");

                    // Register a new target chain.
                    await addPeerForTest(owner, {
                        chain: baseChain,
                        address: foreignSwapLayerAddress,
                        relayParams: relayParamsForTest,
                    });

                    const amountIn = 690000n;
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const [approveIx, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                            peer: swapLayer.peerAddress(baseChain),
                        },
                        {
                            transferType: "sender",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: null,
                            outputToken: null,
                        },
                    );
                    assert.isNull(approveIx);

                    await expectIxErr(
                        connection,
                        [ix],
                        [payer, stagedOutboundSigner],
                        `InvalidTargetChain`,
                    );
                });

                it("Cannot Stage Outbound (Invalid Recipient)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 690000n;
                    const gasDropoff = 42069;
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const [, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                        },
                        {
                            transferType: "sender",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: new Array(32).fill(0),
                            redeemOption: { relay: { gasDropoff, maxRelayerFee: 1000000000n } },
                            outputToken: null,
                        },
                    );

                    await expectIxErr(
                        connection,
                        [ix],
                        [payer, stagedOutboundSigner],
                        "Error Code: InvalidRecipient",
                    );
                });

                it("Cannot Stage Outbound (Exceeds Max Relayer Fee)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 690000n;
                    const gasDropoff = 42069;
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const [, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                        },
                        {
                            transferType: "sender",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: { relay: { gasDropoff, maxRelayerFee: 1n } },
                            outputToken: null,
                        },
                    );

                    await expectIxErr(
                        connection,
                        [ix],
                        [payer, stagedOutboundSigner],
                        "Error Code: ExceedsMaxRelayingFee",
                    );
                });

                it("Cannot Stage Outbound (Relaying Disabled)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

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

                    const amountIn = 690000n;
                    const gasDropoff = 42069;
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const [, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                        },
                        {
                            transferType: "sender",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: { relay: { gasDropoff, maxRelayerFee: 1000000000n } },
                            outputToken: null,
                        },
                    );
                    await expectIxErr(
                        connection,
                        [ix],
                        [payer, stagedOutboundSigner],
                        "RelayingDisabled",
                    );

                    // Set the relay parameters back to the original.
                    await updateRelayParamsForTest(
                        swapLayer,
                        foreignChain,
                        relayParamsForTest,
                        feeUpdater,
                    );
                });

                it("Cannot Stage Outbound (Invalid Gas Dropoff)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 6900000000n;
                    const gasDropoff = relayParamsForTest.maxGasDropoff + 1;
                    const maxRelayerFee = 9999999999999;
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const [, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                        },
                        {
                            transferType: "sender",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: { relay: { gasDropoff, maxRelayerFee } },
                            outputToken: null,
                        },
                    );
                    await expectIxErr(
                        connection,
                        [ix],
                        [payer, stagedOutboundSigner],
                        "InvalidGasDropoff",
                    );
                });

                it("Cannot Stage Outbound (U64 Overflow)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 2n ** 64n - 1n;
                    const gasDropoff = 42069;
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const [, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                        },
                        {
                            transferType: "sender",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: { relay: { gasDropoff, maxRelayerFee: 1000000000n } },
                            outputToken: null,
                        },
                    );

                    await expectIxErr(
                        connection,
                        [ix],
                        [payer, stagedOutboundSigner],
                        "Error Code: U64Overflow",
                    );
                });

                it("Stage Outbound USDC (Relay)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 690000n;
                    const gasDropoff = 42069;
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const [, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                        },
                        {
                            transferType: "sender",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: { relay: { gasDropoff, maxRelayerFee: 1000000000n } },
                            outputToken: null,
                        },
                    );

                    const { amount: balanceBefore } = await splToken.getAccount(
                        connection,
                        senderToken,
                    );
                    await expectIxOk(connection, [ix], [payer, stagedOutboundSigner]);

                    const { amount: balanceAfter } = await splToken.getAccount(
                        connection,
                        senderToken,
                    );

                    const { relayParams } = await swapLayer.fetchPeer(foreignChain);
                    const expectedRelayerFee = calculateRelayerFee(
                        relayParams,
                        denormalizeGasDropOff(gasDropoff),
                        { type: "Usdc" },
                    );
                    assert.equal(balanceBefore - balanceAfter, amountIn + expectedRelayerFee);

                    const stagedOutboundData = await swapLayer.fetchStagedOutbound(stagedOutbound);
                    const { info } = stagedOutboundData;

                    assert.deepEqual(
                        stagedOutboundData,
                        new StagedOutbound(
                            {
                                custodyTokenBump: info.custodyTokenBump,
                                preparedBy: payer.publicKey,
                                sender: payer.publicKey,
                                targetChain: foreignChain,
                                recipient: foreignRecipientAddress,
                                usdcRefundToken: senderToken,
                            },
                            {
                                relay: {
                                    gasDropoff: gasDropoff,
                                    relayingFee: uint64ToBN(expectedRelayerFee),
                                },
                            },
                            Buffer.alloc(1),
                        ),
                    );
                });

                it("Stage Outbound USDC (Direct)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 690000n;
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const [approveIx, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                        },
                        {
                            transferType: "sender",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: null,
                            outputToken: null,
                        },
                    );
                    assert.isNull(approveIx);

                    const { amount: balanceBefore } = await splToken.getAccount(
                        connection,
                        senderToken,
                    );
                    await expectIxOk(connection, [ix], [payer, stagedOutboundSigner]);

                    const { amount: balanceAfter } = await splToken.getAccount(
                        connection,
                        senderToken,
                    );
                    assert.equal(balanceBefore - balanceAfter, amountIn);

                    const stagedOutboundData = await swapLayer.fetchStagedOutbound(stagedOutbound);
                    const { info } = stagedOutboundData;
                    assert.deepEqual(
                        stagedOutboundData,
                        new StagedOutbound(
                            {
                                custodyTokenBump: info.custodyTokenBump,
                                preparedBy: payer.publicKey,
                                sender: payer.publicKey,
                                targetChain: foreignChain,
                                recipient: foreignRecipientAddress,
                                usdcRefundToken: senderToken,
                            },
                            { direct: {} },
                            Buffer.alloc(1),
                        ),
                    );
                });

                it("Stage Outbound Other (Direct)", async function () {
                    const stagedOutboundSigner = Keypair.generate();
                    const stagedOutbound = stagedOutboundSigner.publicKey;

                    const amountIn = 690000n;
                    const outputToken: OutputToken = {
                        type: "Gas",
                        swap: {
                            deadline: 0,
                            limitAmount: 0n,
                            type: {
                                id: "UniswapV3",
                                firstPoolId: 500,
                                path: [
                                    {
                                        address: "0x5991A2dF15A8F6A256D3Ec51E99254Cd3fb576A9",
                                        poolId: 500,
                                    },
                                ],
                            },
                        },
                    };
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );
                    const [approveIx, ix] = await swapLayer.stageOutboundIx(
                        {
                            payer: payer.publicKey,
                            senderToken,
                            stagedOutbound,
                            usdcRefundToken: senderToken,
                        },
                        {
                            transferType: "sender",
                            amountIn,
                            targetChain: foreignChain,
                            recipient: foreignRecipientAddress,
                            redeemOption: null,
                            outputToken,
                        },
                    );
                    assert.isNull(approveIx);

                    const { amount: balanceBefore } = await splToken.getAccount(
                        connection,
                        senderToken,
                    );
                    await expectIxOk(connection, [ix], [payer, stagedOutboundSigner]);

                    const { amount: balanceAfter } = await splToken.getAccount(
                        connection,
                        senderToken,
                    );
                    assert.equal(balanceBefore - balanceAfter, amountIn);

                    const stagedOutboundData = await swapLayer.fetchStagedOutbound(stagedOutbound);
                    const { info } = stagedOutboundData;
                    assert.deepEqual(
                        stagedOutboundData,
                        new StagedOutbound(
                            {
                                custodyTokenBump: info.custodyTokenBump,
                                preparedBy: payer.publicKey,
                                sender: payer.publicKey,
                                targetChain: foreignChain,
                                recipient: foreignRecipientAddress,
                                usdcRefundToken: senderToken,
                            },
                            { direct: {} },
                            Buffer.from(encodeOutputToken(outputToken)),
                        ),
                    );
                });
            });
        });

        describe("USDC Transfer (Relay)", function () {
            describe("Outbound", function () {
                it("Cannot Initiate Transfer (Invalid Prepared By)", async function () {
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );

                    const { stagedOutbound, stagedCustodyToken } = await stageOutboundForTest({
                        payer: payer.publicKey,
                        senderToken,
                    });

                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: swapLayer.preparedOrderAddress(stagedOutbound),
                            stagedOutbound,
                            stagedCustodyToken,
                            preparedBy: ownerAssistant.publicKey, // Invalid pubkey.
                        },
                        { targetChain: foreignChain },
                    );

                    await expectIxErr(connection, [ix], [payer], "Error Code: ConstraintAddress");
                });

                it("Cannot Initiate Transfer (Invalid Refund Token)", async function () {
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );

                    const { stagedOutbound, stagedCustodyToken } = await stageOutboundForTest({
                        payer: payer.publicKey,
                        senderToken,
                    });

                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: swapLayer.preparedOrderAddress(stagedOutbound),
                            stagedOutbound,
                            stagedCustodyToken,
                            usdcRefundToken: ownerAssistant.publicKey, // Invalid pubkey.
                        },
                        { targetChain: foreignChain },
                    );

                    await expectIxErr(connection, [ix], [payer], "Error Code: ConstraintAddress");
                });

                it("Cannot Initiate Transfer (Non-Existent Peer)", async function () {
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );

                    const { stagedOutbound, stagedCustodyToken } = await stageOutboundForTest({
                        payer: payer.publicKey,
                        senderToken,
                    });

                    const invalidChain = toChainId("Holesky");

                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: swapLayer.preparedOrderAddress(stagedOutbound),
                            stagedOutbound,
                            stagedCustodyToken,
                        },
                        { targetChain: invalidChain },
                    );

                    await expectIxErr(
                        connection,
                        [ix],
                        [payer],
                        "peer. Error Code: AccountNotInitialized",
                    );
                });

                it("Cannot Initiate Transfer (Invalid Peer)", async function () {
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );

                    // Prepare the staged outbound with the foreignChain.
                    const { stagedOutbound, stagedCustodyToken } = await stageOutboundForTest({
                        payer: payer.publicKey,
                        senderToken,
                    });

                    const holeskyChain = toChainId("Holesky");

                    // Need to register a peer for holesky to trigger the invalid peer error.
                    await addPeerForTest(owner, {
                        chain: holeskyChain,
                        address: foreignSwapLayerAddress,
                        relayParams: relayParamsForTest,
                    });

                    const ix = await swapLayer.initiateTransferIx(
                        {
                            payer: payer.publicKey,
                            preparedOrder: swapLayer.preparedOrderAddress(stagedOutbound),
                            stagedOutbound,
                            stagedCustodyToken,
                        },
                        { targetChain: holeskyChain },
                    );

                    await expectIxErr(connection, [ix], [payer], "InvalidPeer");
                });

                for (const gasDropoff of [0, 500000]) {
                    for (const isSwap of [true, false]) {
                        it(`Initiate Transfer ${gasDropoff > 0 ? "With" : "Without"} Gas Dropoff (${
                            isSwap ? "With" : "Without"
                        } Swap)`, async function () {
                            const amountIn = 6900000000n;
                            const maxRelayerFee = 9999999999999;
                            const outputToken: OutputToken = isSwap
                                ? { type: "Usdc" }
                                : {
                                      type: "Gas",
                                      swap: {
                                          deadline: 0,
                                          limitAmount: 0n,
                                          type: {
                                              id: "UniswapV3",
                                              firstPoolId: 500,
                                              path: [
                                                  {
                                                      address:
                                                          "0x5991A2dF15A8F6A256D3Ec51E99254Cd3fb576A9",
                                                      poolId: 500,
                                                  },
                                              ],
                                          },
                                      },
                                  };

                            // Fetch peer data.
                            const peer = await swapLayer.fetchPeer(foreignChain);

                            const expectedRelayerFee = calculateRelayerFee(
                                peer.relayParams,
                                denormalizeGasDropOff(gasDropoff),
                                outputToken,
                            );

                            const senderToken = splToken.getAssociatedTokenAddressSync(
                                swapLayer.usdcMint,
                                payer.publicKey,
                            );

                            const { stagedOutbound, stagedCustodyToken } =
                                await stageOutboundForTest(
                                    {
                                        payer: payer.publicKey,
                                        senderToken,
                                    },
                                    {
                                        amountIn,
                                        redeemOption: {
                                            relay: {
                                                gasDropoff,
                                                maxRelayerFee: new BN(maxRelayerFee),
                                            },
                                        },
                                        outputToken,
                                    },
                                );

                            const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);

                            const ix = await swapLayer.initiateTransferIx({
                                payer: payer.publicKey,
                                preparedOrder,
                                stagedOutbound,
                                stagedCustodyToken,
                            });

                            await expectIxOk(connection, [ix], [payer]);

                            // Verify the relevant information in the prepared order.
                            const preparedOrderData = await tokenRouter.fetchPreparedOrder(
                                preparedOrder,
                            );

                            const {
                                info: { preparedCustodyTokenBump },
                            } = preparedOrderData;

                            assert.deepEqual(
                                preparedOrderData,
                                new PreparedOrder(
                                    {
                                        orderSender: swapLayer.custodianAddress(),
                                        preparedBy: payer.publicKey,
                                        orderType: {
                                            market: {
                                                minAmountOut: null,
                                            },
                                        },
                                        srcToken: stagedCustodyToken,
                                        refundToken: senderToken,
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
                                            outputToken,
                                        }),
                                    ),
                                ),
                            );

                            // Verify the prepared custody token balance.
                            const { amount: preparedCustodyTokenBalance } =
                                await splToken.getAccount(
                                    connection,
                                    tokenRouter.preparedCustodyTokenAddress(preparedOrder),
                                );
                            assert.equal(
                                preparedCustodyTokenBalance,
                                amountIn + expectedRelayerFee,
                            );
                        });
                    }
                }
            });

            describe("Inbound", function () {
                it("Cannot Complete Transfer (Invalid Fee Recipient)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
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

                it("Cannot Complete Transfer (Swap Time Limit Not Exceeded)", async function () {
                    const currTime = await connection.getBlockTime(await connection.getSlot());
                    const result = await createAndRedeemCctpFillForTest(
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
                        {
                            vaaTimestamp:
                                currTime - relayParamsForTest.swapTimeLimit.finalizedLimit + 5,
                        },
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

                    await expectIxErr(
                        connection,
                        [transferIx],
                        [payer],
                        "SwapTimeLimitNotExceeded",
                    );
                });

                it("Cannot Complete Transfer (Invalid Recipient)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
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

                    assert.equal(recipientAfter, recipientBefore + message.deposit!.message.amount);
                    assert.isBelow(payerLamportAfter, payerLamportBefore);
                    assert.equal(feeRecipientAfter, feeRecipientBefore);
                });

                it("Complete Transfer With Gas Dropoff", async function () {
                    const relayerFee = 1000000n;
                    const gasAmountDenorm = 690000000;

                    const result = await createAndRedeemCctpFillForTest(
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

                    assert.equal(
                        recipientAfter - recipientBefore,
                        message.deposit!.message.amount - relayerFee,
                    );
                    assert.equal(recipientLamportAfter - recipientLamportBefore, gasAmountDenorm);
                    assert.isBelow(payerLamportAfter, payerLamportBefore - gasAmountDenorm);
                    assert.equal(feeRecipientAfter, feeRecipientBefore + relayerFee);
                });

                it("Complete Transfer Without Gas Dropoff", async function () {
                    const relayerFee = 1000000n;
                    const gasAmount = 0;

                    const result = await createAndRedeemCctpFillForTest(
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

                    assert.equal(
                        recipientAfter - recipientBefore,
                        message.deposit!.message.amount - relayerFee,
                    );
                    assert.equal(recipientLamportAfter - recipientLamportBefore, gasAmount);
                    assert.isBelow(payerLamportAfter, payerLamportBefore - gasAmount);
                    assert.equal(feeRecipientAfter, feeRecipientBefore + relayerFee);
                });

                it("Complete Transfer With Gas Dropoff (Failed Encoded Swap)", async function () {
                    const relayerFee = 1000000n;
                    const gasAmountDenorm = 690000000;
                    const currTime = await connection.getBlockTime(await connection.getSlot());

                    const result = await createAndRedeemCctpFillForTest(
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
                        {
                            vaaTimestamp:
                                currTime - relayParamsForTest.swapTimeLimit.finalizedLimit - 1,
                        },
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

                    assert.equal(
                        recipientAfter - recipientBefore,
                        message.deposit!.message.amount - relayerFee,
                    );
                    assert.equal(recipientLamportAfter - recipientLamportBefore, gasAmountDenorm);
                    assert.isBelow(payerLamportAfter, payerLamportBefore - gasAmountDenorm);
                    assert.equal(feeRecipientAfter, feeRecipientBefore + relayerFee);
                });
            });
        });

        describe("USDC Transfer (Direct)", function () {
            describe("Outbound", function () {
                it("Initiate Transfer", async function () {
                    const amountIn = 6900000000n;
                    const outputToken: OutputToken = { type: "Usdc" };

                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );

                    const { stagedOutbound, stagedCustodyToken } = await stageOutboundForTest(
                        {
                            payer: payer.publicKey,
                            senderToken,
                        },
                        {
                            amountIn,
                            redeemOption: null,
                            outputToken,
                        },
                    );

                    const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);

                    const ix = await swapLayer.initiateTransferIx({
                        payer: payer.publicKey,
                        preparedOrder,
                        stagedOutbound,
                        stagedCustodyToken,
                    });

                    await expectIxOk(connection, [ix], [payer]);

                    // Verify the relevant information in the prepared order.
                    const preparedOrderData = await tokenRouter.fetchPreparedOrder(preparedOrder);

                    const {
                        info: { preparedCustodyTokenBump },
                    } = preparedOrderData;

                    assert.deepEqual(
                        preparedOrderData,
                        new PreparedOrder(
                            {
                                orderSender: swapLayer.custodianAddress(),
                                preparedBy: payer.publicKey,
                                orderType: {
                                    market: {
                                        minAmountOut: null,
                                    },
                                },
                                srcToken: stagedCustodyToken,
                                refundToken: senderToken,
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
                                    outputToken,
                                }),
                            ),
                        ),
                    );

                    // Verify the prepared custody token balance.
                    const { amount: preparedCustodyTokenBalance } = await splToken.getAccount(
                        connection,
                        tokenRouter.preparedCustodyTokenAddress(preparedOrder),
                    );
                    assert.equal(preparedCustodyTokenBalance, amountIn);
                });
            });

            describe("Inbound", function () {
                it("Cannot Complete Transfer (Invalid Swap Message)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
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
                        testCctpNonce++,
                        foreignChain,
                        foreignTokenRouterAddress,
                        Array.from(
                            Buffer.alloc(
                                32,
                                "00000000000000000000000000000000000000000000000000000000deadbeef",
                                "hex",
                            ),
                        ), // Invalid Address
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

                    assert.equal(recipientAfter, recipientBefore + message.deposit!.message.amount);
                    assert.isAbove(beneficiaryAfter, beneficiaryBefore);
                });

                it("Complete Transfer (Recipient Is Payer)", async function () {
                    const result = await createAndRedeemCctpFillForTest(
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

                    assert.equal(recipientAfter, recipientBefore + message.deposit!.message.amount);
                    assert.isAbove(beneficiaryAfter, beneficiaryBefore);
                });
            });
        });

        describe("USDC Transfer (Payload)", function () {
            describe("Outbound", function () {
                it("Initiate Transfer", async function () {
                    const amountIn = 6900000000n;
                    const outputToken: OutputToken = { type: "Usdc" };
                    const payload = Buffer.from("Insert payload here");

                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        swapLayer.usdcMint,
                        payer.publicKey,
                    );

                    const { stagedOutbound, stagedCustodyToken } = await stageOutboundForTest(
                        {
                            payer: payer.publicKey,
                            senderToken,
                        },
                        {
                            amountIn,
                            redeemOption: { payload },
                            outputToken,
                        },
                    );

                    const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);

                    const ix = await swapLayer.initiateTransferIx({
                        payer: payer.publicKey,
                        preparedOrder,
                        stagedOutbound,
                        stagedCustodyToken,
                    });

                    await expectIxOk(connection, [ix], [payer]);

                    // Verify the relevant information in the prepared order.
                    const preparedOrderData = await tokenRouter.fetchPreparedOrder(preparedOrder);

                    const {
                        info: { preparedCustodyTokenBump },
                    } = preparedOrderData;

                    assert.deepEqual(
                        preparedOrderData,
                        new PreparedOrder(
                            {
                                orderSender: swapLayer.custodianAddress(),
                                preparedBy: payer.publicKey,
                                orderType: {
                                    market: {
                                        minAmountOut: null,
                                    },
                                },
                                srcToken: stagedCustodyToken,
                                refundToken: senderToken,
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
                                    outputToken,
                                }),
                            ),
                        ),
                    );

                    // Verify the prepared custody token balance.
                    const { amount: preparedCustodyTokenBalance } = await splToken.getAccount(
                        connection,
                        tokenRouter.preparedCustodyTokenAddress(preparedOrder),
                    );
                    assert.equal(preparedCustodyTokenBalance, amountIn);
                });
            });

            describe("Inbound", function () {
                const payload = Buffer.from("Insert payload here");
                const validSwapMessage = encodeSwapLayerMessage({
                    recipient: new UniversalAddress(recipient.publicKey.toString(), "base58"),
                    redeemMode: { mode: "Payload", payload },
                    outputToken: { type: "Usdc" },
                });

                describe("Stage Inbound", function () {
                    it("Cannot Stage Inbound (Invalid Output Token)", async function () {
                        // Try to complete the swap with an invalid output token (include
                        // swap instructions).
                        const result = await createAndRedeemCctpFillForTest(
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
                                    mode: "Payload",
                                    payload: Buffer.from("Insert payload here"),
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
                        const beneficiary = Keypair.generate();

                        const transferIx = await swapLayer.completeTransferPayloadIx(
                            {
                                payer: payer.publicKey,
                                beneficiary: beneficiary.publicKey,
                                preparedFill,
                            },
                            foreignChain,
                        );

                        await expectIxErr(connection, [transferIx], [payer], "InvalidOutputToken");
                    });

                    it("Cannot Stage Inbound (Invalid Swap Message)", async function () {
                        const result = await createAndRedeemCctpFillForTest(
                            testCctpNonce++,
                            foreignChain,
                            foreignTokenRouterAddress,
                            foreignSwapLayerAddress,
                            wormholeSequence,
                            Buffer.from("invalid message"),
                        );
                        const { vaa } = result!;

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

                        await expectIxErr(connection, [transferIx], [payer], "InvalidSwapMessage");
                    });

                    it("Cannot Stage Inbound (Peer Doesn't Exist)", async function () {
                        const result = await createAndRedeemCctpFillForTest(
                            testCctpNonce++,
                            foreignChain,
                            foreignTokenRouterAddress,
                            foreignSwapLayerAddress,
                            wormholeSequence,
                            validSwapMessage,
                        );
                        const { vaa } = result!;

                        const preparedFill = tokenRouter.preparedFillAddress(vaa);
                        const beneficiary = Keypair.generate();

                        const transferIx = await swapLayer.completeTransferPayloadIx(
                            {
                                payer: payer.publicKey,
                                beneficiary: beneficiary.publicKey,
                                preparedFill,
                            },
                            toChainId("Optimism"), // Invalid chain.
                        );

                        await expectIxErr(
                            connection,
                            [transferIx],
                            [payer],
                            "AccountNotInitialized",
                        );
                    });

                    it("Cannot Stage Inbound (Chain Mismatch)", async function () {
                        const result = await createAndRedeemCctpFillForTest(
                            testCctpNonce++,
                            foreignChain,
                            foreignTokenRouterAddress,
                            foreignSwapLayerAddress,
                            wormholeSequence,
                            validSwapMessage,
                        );
                        const { vaa } = result!;

                        const preparedFill = tokenRouter.preparedFillAddress(vaa);
                        const beneficiary = Keypair.generate();

                        const transferIx = await swapLayer.completeTransferPayloadIx(
                            {
                                payer: payer.publicKey,
                                beneficiary: beneficiary.publicKey,
                                preparedFill,
                            },
                            toChainId("Holesky"), // Invalid chain.
                        );

                        await expectIxErr(connection, [transferIx], [payer], "InvalidPeer");
                    });

                    it("Cannot Stage Inbound (Invalid Peer)", async function () {
                        const result = await createAndRedeemCctpFillForTest(
                            testCctpNonce++,
                            foreignChain,
                            foreignTokenRouterAddress,
                            Array.from(
                                Buffer.alloc(
                                    32,
                                    "00000000000000000000000000000000000000000000000000000000deadbeef",
                                    "hex",
                                ),
                            ), // Invalid Address
                            wormholeSequence,
                            validSwapMessage,
                        );
                        const { vaa } = result!;

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

                        await expectIxErr(connection, [transferIx], [payer], "InvalidPeer");
                    });

                    it("Cannot Stage Inbound (Invalid Redeem Mode)", async function () {
                        const result = await createAndRedeemCctpFillForTest(
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
                        const beneficiary = Keypair.generate();

                        const transferIx = await swapLayer.completeTransferPayloadIx(
                            {
                                payer: payer.publicKey,
                                beneficiary: beneficiary.publicKey,
                                preparedFill,
                            },
                            foreignChain,
                        );

                        await expectIxErr(connection, [transferIx], [payer], "InvalidRedeemMode");
                    });

                    it("Stage Inbound", async function () {
                        const result = await createAndRedeemCctpFillForTest(
                            testCctpNonce++,
                            foreignChain,
                            foreignTokenRouterAddress,
                            foreignSwapLayerAddress,
                            wormholeSequence,
                            validSwapMessage,
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
                            swapLayer.stagedCustodyTokenAddress(stagedInbound);

                        const { amount: balanceAfter } = await splToken.getAccount(
                            connection,
                            stagedInboundTokenAddress,
                        );
                        assert.equal(balanceAfter, message.deposit!.message.amount);

                        // State check.
                        const stagedInboundData = await swapLayer.fetchStagedInbound(stagedInbound);
                        assert.deepEqual(
                            stagedInboundData,
                            new StagedInbound(
                                {
                                    preparedFill,
                                    bump: stagedInboundData.seeds.bump,
                                },
                                {
                                    custodyToken: stagedInboundTokenAddress,
                                    stagedBy: payer.publicKey,
                                    sourceChain: foreignChain,
                                    recipient: recipient.publicKey,
                                    isNative: false,
                                },
                                payload,
                            ),
                        );
                    });
                });

                describe("Release Inbound", function () {
                    it("Cannot Release Inbound (Invalid Recipient)", async function () {
                        const { stagedInbound } = await stageInboundForTest(validSwapMessage, {
                            payer: payer.publicKey,
                        });

                        // Pass a different recipient than the one encoded in validSwapMessage.
                        const consumeIx = await swapLayer.releaseInboundIx({
                            recipient: payer.publicKey,
                            stagedInbound,
                        });

                        await expectIxErr(connection, [consumeIx], [payer], "ConstraintAddress");
                    });

                    it("Release Inbound", async function () {
                        const { stagedInbound, stagedInboundCustody } = await stageInboundForTest(
                            validSwapMessage,
                            { payer: payer.publicKey },
                        );

                        const beneficiary = Keypair.generate();
                        const dstToken = await createTokenAccountForTest();

                        // Balance check.
                        const expectedLamports = await connection
                            .getAccountInfo(stagedInbound)
                            .then((info) => info!.lamports);
                        const { amount: stagedTokenBalance } = await splToken.getAccount(
                            connection,
                            stagedInboundCustody,
                        );
                        const expectedCustodyTokenLamports = await connection
                            .getAccountInfo(stagedInboundCustody)
                            .then((info) => info!.lamports);

                        // Consume the staged inbound account.
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
                            assert.isNull(accInfo);
                        }
                        {
                            const accInfo = await connection.getAccountInfo(stagedInboundCustody);
                            assert.isNull(accInfo);
                        }

                        // Verify balance changes.
                        const { amount: dstTokenBalance } = await splToken.getAccount(
                            connection,
                            dstToken,
                        );
                        assert.equal(dstTokenBalance, stagedTokenBalance);

                        const beneficiaryBalance = await connection.getBalance(
                            beneficiary.publicKey,
                        );
                        assert.equal(
                            beneficiaryBalance,
                            expectedLamports + expectedCustodyTokenLamports,
                        );
                    });
                });
            });
        });
    });

    async function createAndRedeemCctpFillForTest(
        cctpNonce: bigint,
        foreignChain: number,
        foreignEndpointAddress: number[],
        orderSender: number[],
        wormholeSequence: bigint,
        redeemerMessage: Buffer | Uint8Array,
        args?: { vaaTimestamp?: number },
    ): Promise<null | { vaa: PublicKey; message: LiquidityLayerMessage }> {
        const encodedMintRecipient = Array.from(tokenRouter.cctpMintRecipientAddress().toBuffer());
        const sourceCctpDomain = 0;
        const amount = 6900000000n;
        const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
        const redeemer = swapLayer.custodianAddress();

        // Concoct a Circle message.
        const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
            await craftCctpTokenBurnMessage(
                sourceCctpDomain,
                cctpNonce,
                encodedMintRecipient,
                amount,
                burnSource,
            );

        const message = new LiquidityLayerMessage({
            deposit: new LiquidityLayerDeposit({
                tokenAddress: toUniversalAddress(burnMessage.burnTokenAddress),
                amount,
                sourceCctpDomain,
                destinationCctpDomain,
                cctpNonce,
                burnSource: toUniversalAddress(burnSource),
                mintRecipient: toUniversalAddress(encodedMintRecipient),
                payload: {
                    id: 1,
                    sourceChain: toChain(foreignChain),
                    orderSender: toUniversalAddress(orderSender),
                    redeemer: toUniversalAddress(redeemer.toBuffer()),
                    redeemerMessage: Buffer.from(redeemerMessage),
                },
            }),
        });

        const vaa = await postLiquidityLayerVaa(
            connection,
            payer,
            MOCK_GUARDIANS,
            foreignEndpointAddress,
            wormholeSequence++,
            message,
            { sourceChain: "Ethereum", timestamp: args?.vaaTimestamp },
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
        sourceCctpDomain: number,
        cctpNonce: bigint,
        encodedMintRecipient: number[],
        amount: bigint,
        burnSource: number[],
        overrides: { destinationCctpDomain?: number } = {},
    ) {
        let { destinationCctpDomain } = overrides;

        const messageTransmitterProgram = tokenRouter.messageTransmitterProgram();
        const { version, localDomain } =
            await messageTransmitterProgram.fetchMessageTransmitterConfig(
                messageTransmitterProgram.messageTransmitterConfigAddress(),
            );
        destinationCctpDomain ??= localDomain;

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

    async function stageOutboundForTest(
        accounts: {
            payer: PublicKey;
            senderToken: PublicKey;
        },
        opts: {
            amountIn?: bigint;
            redeemOption?:
                | { relay: { gasDropoff: number; maxRelayerFee: Uint64 } }
                | { payload: Uint8Array | Buffer }
                | null;
            outputToken?: OutputToken | null;
        } = {},
    ) {
        const stagedOutboundSigner = Keypair.generate();
        const stagedOutbound = stagedOutboundSigner.publicKey;

        let { amountIn, redeemOption, outputToken } = opts;
        amountIn ??= 690000n;
        redeemOption ??= null;
        outputToken ??= null;

        const [approveIx, ix] = await swapLayer.stageOutboundIx(
            {
                ...accounts,
                stagedOutbound,
                usdcRefundToken: accounts.senderToken,
            },
            {
                transferType: "sender",
                amountIn,
                targetChain: foreignChain,
                recipient: foreignRecipientAddress,
                redeemOption,
                outputToken,
            },
        );
        assert.isNull(approveIx);

        await expectIxOk(connection, [ix], [payer, stagedOutboundSigner]);

        const stagedCustodyToken = swapLayer.stagedCustodyTokenAddress(stagedOutbound);
        const { amount: custodyBalance } = await splToken.getAccount(
            connection,
            stagedCustodyToken,
        );

        return { stagedOutbound, stagedCustodyToken, custodyBalance };
    }

    async function stageInboundForTest(
        validSwapMessage: Buffer | Uint8Array,
        accounts: {
            payer: PublicKey;
            beneficiary?: PublicKey;
        },
    ) {
        const result = await createAndRedeemCctpFillForTest(
            testCctpNonce++,
            foreignChain,
            foreignTokenRouterAddress,
            foreignSwapLayerAddress,
            wormholeSequence,
            validSwapMessage,
        );
        const { vaa } = result!;

        const preparedFill = tokenRouter.preparedFillAddress(vaa);

        const transferIx = await swapLayer.completeTransferPayloadIx(
            {
                ...accounts,
                preparedFill,
            },
            foreignChain,
        );

        await expectIxOk(connection, [transferIx], [payer]);

        // Balance check.
        const stagedInbound = swapLayer.stagedInboundAddress(preparedFill);
        const stagedInboundCustody = swapLayer.stagedCustodyTokenAddress(stagedInbound);

        return { stagedInbound, stagedInboundCustody };
    }

    async function createTokenAccountForTest() {
        const tokenOwner = Keypair.generate();
        const token = splToken.getAssociatedTokenAddressSync(
            USDC_MINT_ADDRESS,
            tokenOwner.publicKey,
        );
        await expectIxOk(
            connection,
            [
                splToken.createAssociatedTokenAccountInstruction(
                    payer.publicKey,
                    token,
                    tokenOwner.publicKey,
                    USDC_MINT_ADDRESS,
                ),
            ],
            [payer],
        );

        return token;
    }

    async function addPeerForTest(ownerOrAssistant: Keypair, addPeerArgs: AddPeerArgs) {
        const ix = await swapLayer.addPeerIx(
            {
                ownerOrAssistant: ownerOrAssistant.publicKey,
            },
            addPeerArgs,
        );

        await expectIxOk(swapLayer.program.provider.connection, [ix], [ownerOrAssistant]);
    }
});
