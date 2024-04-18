import * as anchor from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import * as wormholeSdk from "@certusone/wormhole-sdk";
import {
    AddressLookupTableProgram,
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    ComputeBudgetProgram,
} from "@solana/web3.js";
import { expectIxOk, hackedExpectDeepEqual } from "./helpers";
import { FEE_UPDATER_KEYPAIR } from "./helpers";
import { SwapLayerProgram, localnet, Custodian } from "../src/swapLayer";
import { use as chaiUse, expect } from "chai";
import * as tokenRouterSdk from "../../../lib/example-liquidity-layer/solana/ts/src/tokenRouter";
import {
    LiquidityLayerDeposit,
    LiquidityLayerMessage,
} from "../../../lib/example-liquidity-layer/solana/ts/src/common";
import {
    postLiquidityLayerVaa,
    LOCALHOST,
    PAYER_KEYPAIR,
    OWNER_KEYPAIR,
    OWNER_ASSISTANT_KEYPAIR,
    USDC_MINT_ADDRESS,
    ETHEREUM_USDC_ADDRESS,
    MOCK_GUARDIANS,
    CircleAttester,
} from "../../../lib/example-liquidity-layer/solana/ts/tests/helpers";
import { VaaAccount } from "../../../lib/example-liquidity-layer/solana/ts/src/wormhole";
import { CctpTokenBurnMessage } from "../../../lib/example-liquidity-layer/solana/ts/src/cctp";

chaiUse(require("chai-as-promised"));

describe("swap-layer", () => {
    const connection = new Connection(LOCALHOST, "processed");
    const payer = PAYER_KEYPAIR;
    const relayer = Keypair.generate();
    const owner = OWNER_KEYPAIR;
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;
    const feeUpdater = FEE_UPDATER_KEYPAIR;
    const feeRecipient = Keypair.generate();
    const feeRecipientToken = splToken.getAssociatedTokenAddressSync(
        USDC_MINT_ADDRESS,
        feeRecipient.publicKey,
    );

    // Sending chain information.
    const foreignChain = wormholeSdk.CHAINS.sepolia;
    const foreignEndpointAddress = Array.from(
        Buffer.alloc(32, "000000000000000000000000603541d1Cf7178C407aA7369b67CB7e0274952e2", "hex"),
    );
    const foreignCctpDomain = 0;

    // Program SDKs
    const swapLayer = new SwapLayerProgram(connection, localnet(), USDC_MINT_ADDRESS);
    const tokenRouter = new tokenRouterSdk.TokenRouterProgram(
        connection,
        tokenRouterSdk.testnet(),
        USDC_MINT_ADDRESS,
    );

    let tokenRouterLkupTable: PublicKey;

    describe("Admin", () => {
        describe("Initialize", () => {
            it("Initialize", async () => {
                const ix = await swapLayer.initializeIx({
                    owner: payer.publicKey,
                    ownerAssistant: ownerAssistant.publicKey,
                    feeRecipient: feeRecipient.publicKey,
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
                    feeRecipient.publicKey,
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
            });

            after("Setup Lookup Table", async function () {
                // Create.
                const [createIx, lookupTable] = await connection.getSlot("finalized").then((slot) =>
                    AddressLookupTableProgram.createLookupTable({
                        authority: payer.publicKey,
                        payer: payer.publicKey,
                        recentSlot: slot,
                    }),
                );

                await expectIxOk(connection, [createIx], [payer]);

                const usdcCommonAccounts = await tokenRouter.commonAccounts();

                // Extend.
                const extendIx = AddressLookupTableProgram.extendLookupTable({
                    payer: payer.publicKey,
                    authority: payer.publicKey,
                    lookupTable,
                    addresses: Object.values(usdcCommonAccounts).filter((key) => key !== undefined),
                });

                await expectIxOk(connection, [extendIx], [payer], {
                    confirmOptions: { commitment: "finalized" },
                });

                tokenRouterLkupTable = lookupTable;
            });
        });
    });

    describe("Business Logic", function () {
        let testCctpNonce = 2n ** 64n - 20n * 6400n;

        let wormholeSequence = 2000n;
        describe("USDC Transfers", function () {
            const encodedMintRecipient = Array.from(
                tokenRouter.cctpMintRecipientAddress().toBuffer(),
            );
            const sourceCctpDomain = 0;
            const amount = 69n;
            const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
            const redeemer = swapLayer.custodianAddress();

            it("Redeem USDC", async function () {
                const cctpNonce = testCctpNonce++;

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
                                sourceChain: foreignChain,
                                orderSender: Array.from(Buffer.alloc(32, "d00d", "hex")),
                                redeemer: Array.from(redeemer.toBuffer()),
                                redeemerMessage: Buffer.from(
                                    "010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d02000000000000000f424000",
                                    "hex",
                                ),
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
                    { sourceChain: "sepolia" },
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

                const vaaAccount = await VaaAccount.fetch(connection, vaa);
                const preparedFill = tokenRouter.preparedFillAddress(vaaAccount.digest());

                const transferIx = await swapLayer.completeTransferRelayIx({
                    payer: payer.publicKey,
                    beneficiary: payer.publicKey,
                    preparedFill,
                    tokenRouterCustody: tokenRouter.preparedCustodyTokenAddress(preparedFill),
                    tokenRouterProgram: tokenRouter.ID,
                });

                await expectIxOk(connection, [transferIx], [payer]);
            });

            it.skip("Redeem USDC With Gas DropOff", async function () {});
        });

        describe("Jupiter V6 Swap", function () {
            // TODO

            before("Not Paused", async function () {
                const custodian = await tokenRouter.fetchCustodian();
                expect(custodian.paused).is.false;
            });
        });
    });
});

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
        Array.from(wormholeSdk.tryNativeToUint8Array(ETHEREUM_USDC_ADDRESS, "ethereum")), // sourceTokenAddress
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
