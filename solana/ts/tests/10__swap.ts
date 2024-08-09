import * as splToken from "@solana/spl-token";
import {
    AddressLookupTableAccount,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    Signer,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import {
    FastMarketOrder,
    SlowOrderResponse,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { CctpTokenBurnMessage } from "@wormhole-foundation/example-liquidity-layer-solana/cctp";
import {
    LiquidityLayerDeposit,
    LiquidityLayerMessage,
    Uint64,
} from "@wormhole-foundation/example-liquidity-layer-solana/common";
import * as matchingEngineSdk from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import {
    CHAIN_TO_DOMAIN,
    CircleAttester,
    ETHEREUM_USDC_ADDRESS,
    LOCALHOST,
    MOCK_GUARDIANS,
    PAYER_KEYPAIR,
    REGISTERED_TOKEN_ROUTERS,
    USDC_MINT_ADDRESS,
    expectIxErr,
    expectIxOk,
    getBlockTime,
    getUsdcAtaBalance,
    postLiquidityLayerVaa,
    toUniversalAddress,
} from "@wormhole-foundation/example-liquidity-layer-solana/testing";
import * as tokenRouterSdk from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter";
import { VaaAccount } from "@wormhole-foundation/example-liquidity-layer-solana/wormhole";
import { Chain, ChainId, toChainId } from "@wormhole-foundation/sdk-base";
import { UniversalAddress, toNative, toUniversal } from "@wormhole-foundation/sdk-definitions";
import "@wormhole-foundation/sdk-solana/address";
import { assert } from "chai";
import * as fs from "fs";
import * as jupiterV6 from "../src/jupiterV6";
import {
    OutputToken,
    RedeemMode,
    StagedInbound,
    StagedOutboundInfo,
    SwapLayerMessage,
    SwapLayerProgram,
    TEST_RELAY_PARAMS,
    calculateRelayerFee,
    decodeSwapLayerMessage,
    denormalizeGasDropOff,
    encodeSwapLayerMessage,
    localnet,
} from "../src/swapLayer";
import {
    BERN_MINT_ADDRESS,
    BONK_MINT_ADDRESS,
    FEE_UPDATER_KEYPAIR,
    REGISTERED_PEERS,
    USDT_MINT_ADDRESS,
    createAta,
    createLut,
    tryNativeToUint8Array,
    whichTokenProgram,
} from "./helpers";

const JUPITER_V6_LUT_ADDRESSES = [
    new PublicKey("GxS6FiQ3mNnAar9HGQ6mxP7t6FcwmHkU7peSeQDUHmpN"),
    new PublicKey("HsLPzBjqK3SUKQZwHdd2QHVc9cioPrsHNw9GcUDs7WL7"),
];

const JUPITER_V6_LUT_ADDRESSES_BERN = [
    new PublicKey("2aGZxQimbQhRsvQhjvjXE35vZGJP2ajBSrUggoEwGGy4"),
    new PublicKey("8Vaso6eE1pWktDHwy2qQBB1fhjmBgwzhoXQKe1sxtFjn"),
    new PublicKey("BpQ5uMzQNWNgBCRNf6jffChhYMX5XVZuaoM4Rx16NCdf"),
    new PublicKey("D6XNrxMsDoABJVVY5YyHxJuAB6WGzYCXpZeKyNtqu2v4"),
    new PublicKey("55ir29U8MrZbGBV63XbbweEDXP9DSx7eNenc7hnTM81E"),
];

describe("Swap Layer -- Jupiter V6", () => {
    const connection = new Connection(LOCALHOST, "processed");

    const payer = PAYER_KEYPAIR;
    const testRecipient = Keypair.generate();
    const feeUpdater = FEE_UPDATER_KEYPAIR;

    // Program SDKs
    const swapLayer = new SwapLayerProgram(connection, localnet(), USDC_MINT_ADDRESS);
    const tokenRouter = swapLayer.tokenRouterProgram();
    const matchingEngine = tokenRouter.matchingEngineProgram();

    const luts: PublicKey[] = [PublicKey.default];
    for (let i = 0; i < JUPITER_V6_LUT_ADDRESSES.length; ++i) {
        luts.push(JUPITER_V6_LUT_ADDRESSES[i]);
    }

    let testCctpNonce = 2n ** 64n - 1n;

    // Hack to prevent math overflow error when invoking CCTP programs.
    testCctpNonce -= 100n * 6400n;

    let wormholeSequence = 10000n;

    describe("Swap", function () {
        before("Generate ATAs", async function () {
            for (const mint of [swapLayer.usdcMint, USDT_MINT_ADDRESS, splToken.NATIVE_MINT]) {
                for (let i = 0; i < 8; ++i) {
                    await createAta(connection, payer, mint, jupiterV6.programAuthorityAddress(i));
                }
            }

            const payerWsol = splToken.getAssociatedTokenAddressSync(
                splToken.NATIVE_MINT,
                payer.publicKey,
                false,
                splToken.TOKEN_PROGRAM_ID,
            );

            await expectIxOk(
                connection,
                [
                    splToken.createAssociatedTokenAccountInstruction(
                        payer.publicKey,
                        payerWsol,
                        payer.publicKey,
                        splToken.NATIVE_MINT,
                        splToken.TOKEN_PROGRAM_ID,
                    ),
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: payerWsol,
                        lamports: 2_000_000_000_000n,
                    }),
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: testRecipient.publicKey,
                        lamports: 2_000_000_000_000n,
                    }),
                    splToken.createSyncNativeInstruction(payerWsol, splToken.TOKEN_PROGRAM_ID),
                ],
                [payer],
            );
        });

        after("Setup Lookup Tables", async function () {
            const matchingEngineAccounts = await matchingEngine
                .commonAccounts()
                .then((accounts) => Object.values(accounts).filter((key) => key !== undefined));
            const tokenRouterAccounts = await tokenRouter
                .commonAccounts()
                .then((accounts) => Object.values(accounts).filter((key) => key !== undefined));

            const { feeRecipientToken } = await swapLayer.fetchCustodian();
            const addresses = [
                swapLayer.custodianAddress(),
                feeRecipientToken,
                swapLayer.peerAddress(toChainId("Ethereum")),
                splToken.TOKEN_2022_PROGRAM_ID,
                splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
                splToken.NATIVE_MINT,
                USDT_MINT_ADDRESS,
                BERN_MINT_ADDRESS,
                BONK_MINT_ADDRESS,
            ];
            addresses.push(...matchingEngineAccounts);
            addresses.push(...tokenRouterAccounts);

            luts[0] = await createLut(connection, payer, addresses);
        });

        it("User Swap USDC to USDT From Simulated Quote -- Whirlpool", async function () {
            await modifyUsdcToUsdtSwapResponseForTest(payer.publicKey, {
                inAmount: 100_000_000n,
                quotedOutAmount: 100_000_000n,
                slippageBps: 50,
            }).then(invokeSharedAccountsRouteAsUser);
        });

        it("User Swap USDT to USDC From Simulated Quote -- Whirlpool", async function () {
            await modifyUsdtToUsdcSwapResponseForTest(payer.publicKey, {
                inAmount: 50_000_000n,
                quotedOutAmount: 50_000_000n,
                slippageBps: 50,
            }).then(invokeSharedAccountsRouteAsUser);
        });

        it("User Swap USDC to WSOL From Simulated Quote -- Phoenix V1", async function () {
            await modifyUsdcToWsolSwapResponseForTest(payer.publicKey, {
                inAmount: 150_000_000n,
                quotedOutAmount: 1_000_000_000n,
                slippageBps: 200,
            }).then(invokeSharedAccountsRouteAsUser);
        });

        it("User Swap WSOL to USDC From Simulated Quote -- Phoenix V1", async function () {
            await modifyWsolToUsdcSwapResponseForTest(payer.publicKey, {
                inAmount: 1_000_000_000n,
                quotedOutAmount: 150_000_000n,
                slippageBps: 200,
            }).then(invokeSharedAccountsRouteAsUser);
        });

        it("User Swap USDC to Token-2022 Mint From Simulated Quote -- Multi Route", async function () {
            const addressLookupTableAccounts = await Promise.all(
                JUPITER_V6_LUT_ADDRESSES_BERN.map(async (lookupTableAddress) => {
                    const resp = await connection.getAddressLookupTable(lookupTableAddress);
                    return resp.value;
                }),
            );

            await modifyUsdcTo2022SwapResponseForTest(payer.publicKey, {
                inAmount: 10_000_000n,
                quotedOutAmount: 200_000_000n,
                slippageBps: 1000,
            }).then((modifyArgs) =>
                invokeSharedAccountsRouteAsUser(modifyArgs, addressLookupTableAccounts),
            );
        });

        it("User Swap Token-2022 Mint to USDC From Simulated Quote -- Multi Route", async function () {
            const addressLookupTableAccounts = await Promise.all(
                JUPITER_V6_LUT_ADDRESSES_BERN.map(async (lookupTableAddress) => {
                    const resp = await connection.getAddressLookupTable(lookupTableAddress);
                    return resp.value;
                }),
            );

            await modify2022ToUsdcSwapResponseForTest(payer.publicKey, {
                inAmount: 200_000_000n,
                quotedOutAmount: 10_000_000n,
                slippageBps: 1000,
            }).then((modifyArgs) =>
                invokeSharedAccountsRouteAsUser(modifyArgs, addressLookupTableAccounts),
            );
        });

        async function invokeSharedAccountsRouteAsUser(
            modifyArgs: jupiterV6.ModifiedSharedAccountsRoute,
            addressLookupTableAccounts?: AddressLookupTableAccount[],
        ) {
            const {
                instruction: ix,
                sourceToken: srcToken,
                destinationToken: dstToken,
                minAmountOut,
                sourceTokenProgram,
                destinationTokenProgram,
            } = modifyArgs;

            const { amount: srcBalanceBefore } = await splToken.getAccount(
                connection,
                srcToken,
                undefined,
                sourceTokenProgram,
            );
            const { amount: dstBalanceBefore } = await splToken.getAccount(
                connection,
                dstToken,
                undefined,
                destinationTokenProgram,
            );

            const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                units: 500_000,
            });

            await expectIxOk(connection, [computeIx, ix], [payer], { addressLookupTableAccounts });

            const decodedIxData = jupiterV6.decodeSharedAccountsRouteArgs(ix.data);

            const { amount: srcBalanceAfter } = await splToken.getAccount(
                connection,
                srcToken,
                undefined,
                sourceTokenProgram,
            );

            // This math makes a crude assumption that the # of routes will result in more rounding
            // errors. We can improve this calculation, but the amounts we are dealing with are so
            // small.
            const numRoutes = BigInt(decodedIxData.routePlan.length);
            const srcBalanceChange = srcBalanceBefore - srcBalanceAfter;
            assert.isTrue(srcBalanceChange >= decodedIxData.inAmount - numRoutes);
            assert.isTrue(srcBalanceChange <= decodedIxData.inAmount);

            const { amount: dstBalanceAfter } = await splToken.getAccount(
                connection,
                dstToken,
                undefined,
                destinationTokenProgram,
            );
            assert.isTrue(dstBalanceAfter - dstBalanceBefore >= minAmountOut);
        }
    });

    describe("USDC Swap (Relay)", function () {
        describe("Outbound", function () {
            it("Cannot Swap (Min Amount Out Too Small)", async function () {
                const srcMint = USDT_MINT_ADDRESS;
                const gasDropoff = 500000;

                const { stagedOutbound, custodyBalance: inAmount } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                            false,
                            await whichTokenProgram(connection, srcMint),
                        ),
                        srcMint,
                    },
                    {
                        amountIn: 100000n,
                        minAmountOut: 9999999999999n, // Specify a really large min amount out.
                        redeemOption: {
                            relay: { gasDropoff, maxRelayerFee: 9999999999999n },
                        },
                    },
                );

                const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);
                const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
                const { instruction: cpiInstruction, minAmountOut } =
                    await modifyUsdtToUsdcSwapResponseForTest(swapAuthority, {
                        inAmount,
                        quotedOutAmount: inAmount, // stable swap
                        slippageBps: 10000,
                        cpi: true,
                    });

                await swapExactInForTest(
                    { payer: payer.publicKey, stagedOutbound, srcMint },
                    { cpiInstruction },
                    { errorMsg: "Error Code: InsufficientAmountOut" },
                );
            });

            it("Cannot Swap (Invalid Prepared By)", async function () {
                const srcMint = USDT_MINT_ADDRESS;

                const { stagedOutbound, custodyBalance: inAmount } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                            false,
                            await whichTokenProgram(connection, srcMint),
                        ),
                        srcMint,
                    },
                    {
                        redeemOption: {
                            relay: { gasDropoff: 500000, maxRelayerFee: 9999999999999n },
                        },
                    },
                );

                const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);
                const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
                const { instruction: cpiInstruction } = await modifyUsdtToUsdcSwapResponseForTest(
                    swapAuthority,
                    {
                        inAmount,
                        quotedOutAmount: inAmount, // stable swap
                        slippageBps: 10000,
                        cpi: true,
                    },
                );

                await swapExactInForTest(
                    {
                        payer: payer.publicKey,
                        stagedOutbound,
                        srcMint,
                        preparedBy: testRecipient.publicKey,
                    },
                    { cpiInstruction },
                    { errorMsg: "prepared_by. Error Code: ConstraintAddress" },
                );
            });

            it("Cannot Swap (Invalid USDC Refund Token)", async function () {
                const srcMint = USDT_MINT_ADDRESS;

                const {
                    stagedOutbound,
                    custodyBalance: inAmount,
                    outputToken,
                } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                            false,
                            await whichTokenProgram(connection, srcMint),
                        ),
                        srcMint,
                    },
                    {
                        redeemOption: {
                            relay: { gasDropoff: 500000, maxRelayerFee: 9999999999999n },
                        },
                    },
                );

                const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);
                const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
                const { instruction: cpiInstruction } = await modifyUsdtToUsdcSwapResponseForTest(
                    swapAuthority,
                    {
                        inAmount,
                        quotedOutAmount: inAmount, // stable swap
                        slippageBps: 10000,
                        cpi: true,
                    },
                );

                const invalidToken = await createAta(
                    connection,
                    payer,
                    swapLayer.usdcMint,
                    testRecipient.publicKey,
                );

                await swapExactInForTest(
                    {
                        payer: payer.publicKey,
                        stagedOutbound,
                        srcMint,
                        usdcRefundToken: invalidToken,
                    },
                    { cpiInstruction },
                    { errorMsg: "usdc_refund_token. Error Code: ConstraintAddress" },
                );
            });

            it("Cannot Swap (Invalid Target Chain)", async function () {
                const srcMint = USDT_MINT_ADDRESS;

                const {
                    stagedOutbound,
                    custodyBalance: inAmount,
                    outputToken,
                } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                            false,
                            await whichTokenProgram(connection, srcMint),
                        ),
                        srcMint,
                    },
                    {
                        redeemOption: {
                            relay: { gasDropoff: 500000, maxRelayerFee: 9999999999999n },
                        },
                    },
                );

                const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);
                const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
                const { instruction: cpiInstruction } = await modifyUsdtToUsdcSwapResponseForTest(
                    swapAuthority,
                    {
                        inAmount,
                        quotedOutAmount: inAmount, // stable swap
                        slippageBps: 10000,
                        cpi: true,
                    },
                );

                // Pass a chain id for a peer that has been registered, but is not the
                // target chain for the swap.
                await swapExactInForTest(
                    {
                        payer: payer.publicKey,
                        stagedOutbound,
                        srcMint,
                    },
                    { cpiInstruction, targetChain: toChainId("Holesky") },
                    { errorMsg: "Error Code: ConstraintTokenOwner" },
                );
            });

            it("Cannot Swap (Invalid Source Mint)", async function () {
                const srcMint = USDT_MINT_ADDRESS;

                const {
                    stagedOutbound,
                    custodyBalance: inAmount,
                    outputToken,
                } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                            false,
                            await whichTokenProgram(connection, srcMint),
                        ),
                        srcMint,
                    },
                    {
                        redeemOption: {
                            relay: { gasDropoff: 500000, maxRelayerFee: 9999999999999n },
                        },
                    },
                );

                const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);
                const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
                const { instruction: cpiInstruction } = await modifyUsdtToUsdcSwapResponseForTest(
                    swapAuthority,
                    {
                        inAmount,
                        quotedOutAmount: inAmount, // stable swap
                        slippageBps: 10000,
                        cpi: true,
                    },
                );

                // Pass a chain id for a peer that has been registered, but is not the
                // target chain for the swap.
                await swapExactInForTest(
                    {
                        payer: payer.publicKey,
                        stagedOutbound,
                        srcMint: USDC_MINT_ADDRESS,
                    },
                    { cpiInstruction },
                    { errorMsg: "Error Code: ConstraintTokenMint" },
                );
            });

            it("Cannot Swap (Same Mint)", async function () {
                const srcMint = USDC_MINT_ADDRESS;

                const {
                    stagedOutbound,
                    custodyBalance: inAmount,
                    outputToken,
                } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                            false,
                            await whichTokenProgram(connection, srcMint),
                        ),
                        srcMint,
                    },
                    {
                        minAmountOut: 1n,
                        redeemOption: {
                            relay: { gasDropoff: 500000, maxRelayerFee: 9999999999999n },
                        },
                    },
                );

                const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);
                const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
                const { instruction: cpiInstruction } = await modifyUsdtToUsdcSwapResponseForTest(
                    swapAuthority,
                    {
                        inAmount,
                        quotedOutAmount: inAmount, // stable swap
                        slippageBps: 10000,
                        cpi: true,
                    },
                );

                // Pass a chain id for a peer that has been registered, but is not the
                // target chain for the swap.
                await swapExactInForTest(
                    {
                        payer: payer.publicKey,
                        stagedOutbound,
                        srcMint: USDC_MINT_ADDRESS,
                        stagedCustodyToken: swapLayer.stagedCustodyTokenAddress(stagedOutbound),
                        srcResidual: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                        ),
                    },
                    { cpiInstruction },
                    { errorMsg: "Error Code: SameMint" },
                );
            });

            it("USDT via Whirlpool", async function () {
                const srcMint = USDT_MINT_ADDRESS;

                const {
                    stagedOutbound,
                    stagedCustodyToken,
                    custodyBalance: inAmount,
                    stagedOutboundInfo,
                    redeemMode,
                    outputToken,
                } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                            false,
                            await whichTokenProgram(connection, srcMint),
                        ),
                        srcMint,
                    },
                    {
                        redeemOption: {
                            relay: { gasDropoff: 500000, maxRelayerFee: 9999999999999n },
                        },
                    },
                );

                const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);
                const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
                const {
                    instruction: cpiInstruction,
                    sourceToken,
                    destinationToken,
                    sourceMint,
                    destinationMint,
                    minAmountOut,
                } = await modifyUsdtToUsdcSwapResponseForTest(swapAuthority, {
                    inAmount,
                    quotedOutAmount: inAmount, // stable swap
                    slippageBps: 50,
                    cpi: true,
                });
                assert.deepEqual(sourceMint, srcMint);
                assert.deepEqual(destinationMint, swapLayer.usdcMint);

                {
                    const accInfos = await connection.getMultipleAccountsInfo([
                        sourceToken,
                        destinationToken,
                    ]);
                    assert.isTrue(accInfos.every((info) => info === null));
                }

                await swapExactInForTest(
                    { payer: payer.publicKey, stagedOutbound, srcMint },
                    { cpiInstruction },
                );

                {
                    const accInfos = await connection.getMultipleAccountsInfo([
                        sourceToken,
                        destinationToken,
                        stagedOutbound,
                        stagedCustodyToken,
                    ]);
                    assert.isTrue(accInfos.every((info) => info === null));
                }

                const { targetChain, usdcRefundToken, recipient } = stagedOutboundInfo;
                const { address: redeemer } = await swapLayer.fetchPeer(targetChain as ChainId);

                // Verify the relevant information in the prepared order.
                const preparedOrderData = await tokenRouter.fetchPreparedOrder(preparedOrder);

                const { info } = preparedOrderData;
                assert.deepEqual(
                    preparedOrderData,
                    new tokenRouterSdk.PreparedOrder(
                        {
                            orderSender: swapLayer.custodianAddress(),
                            preparedBy: payer.publicKey,
                            orderType: {
                                market: {
                                    minAmountOut: null,
                                },
                            },
                            srcToken: destinationToken,
                            refundToken: usdcRefundToken,
                            targetChain,
                            redeemer,
                            preparedCustodyTokenBump: info.preparedCustodyTokenBump,
                        },
                        Buffer.from(
                            encodeSwapLayerMessage({
                                recipient: new UniversalAddress(Uint8Array.from(recipient)),
                                redeemMode,
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
                assert.isTrue(preparedCustodyTokenBalance >= minAmountOut);
            });

            it("Token-2022 Mint via Multi-Route", async function () {
                const srcMint = BERN_MINT_ADDRESS;

                const {
                    stagedOutbound,
                    stagedCustodyToken,
                    custodyBalance: inAmount,
                    stagedOutboundInfo,
                    redeemMode,
                    outputToken,
                } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                            false,
                            await whichTokenProgram(connection, srcMint),
                        ),
                        srcMint,
                    },
                    {
                        amountIn: 100_000_000n,
                        redeemOption: {
                            relay: { gasDropoff: 500000, maxRelayerFee: 9999999999999n },
                        },
                    },
                );

                const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);
                const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
                const {
                    instruction: cpiInstruction,
                    sourceToken,
                    destinationToken,
                    sourceMint,
                    destinationMint,
                    minAmountOut,
                } = await modify2022ToUsdcSwapResponseForTest(swapAuthority, {
                    inAmount,
                    quotedOutAmount: 5_000_000n, // 5 USDC
                    slippageBps: 1000,
                    cpi: true,
                });
                assert.deepEqual(sourceMint, srcMint);
                assert.deepEqual(destinationMint, swapLayer.usdcMint);

                {
                    const accInfos = await connection.getMultipleAccountsInfo([
                        sourceToken,
                        destinationToken,
                    ]);
                    assert.isTrue(accInfos.every((info) => info === null));
                }

                await swapExactInForTest(
                    { payer: payer.publicKey, stagedOutbound, srcMint },
                    { cpiInstruction },
                    { additionalLuts: JUPITER_V6_LUT_ADDRESSES_BERN },
                );

                {
                    const accInfos = await connection.getMultipleAccountsInfo([
                        sourceToken,
                        destinationToken,
                        stagedOutbound,
                        stagedCustodyToken,
                    ]);
                    assert.isTrue(accInfos.slice(0, 2).every((info) => info === null));
                    assert.isTrue(accInfos.slice(2, 4).every((info) => info !== null));
                }

                const { targetChain, usdcRefundToken, recipient } = stagedOutboundInfo;
                const { address: redeemer } = await swapLayer.fetchPeer(targetChain as ChainId);

                // Verify the relevant information in the prepared order.
                const preparedOrderData = await tokenRouter.fetchPreparedOrder(preparedOrder);

                const { info } = preparedOrderData;
                assert.deepEqual(
                    preparedOrderData,
                    new tokenRouterSdk.PreparedOrder(
                        {
                            orderSender: swapLayer.custodianAddress(),
                            preparedBy: payer.publicKey,
                            orderType: {
                                market: {
                                    minAmountOut: null,
                                },
                            },
                            srcToken: destinationToken,
                            refundToken: usdcRefundToken,
                            targetChain,
                            redeemer,
                            preparedCustodyTokenBump: info.preparedCustodyTokenBump,
                        },
                        Buffer.from(
                            encodeSwapLayerMessage({
                                recipient: new UniversalAddress(Uint8Array.from(recipient)),
                                redeemMode,
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
                assert.isTrue(preparedCustodyTokenBalance >= minAmountOut);
            });
        });

        describe("Inbound", function () {
            const emittedEvents: EmittedFilledLocalFastOrder[] = [];
            let listenerId: number | null;

            before("Start Event Listener", async function () {
                listenerId = matchingEngine.onFilledLocalFastOrder((event, slot, signature) => {
                    emittedEvents.push({ event, slot, signature });
                });
            });

            after("Stop Event Listener", async function () {
                if (listenerId !== null) {
                    matchingEngine.program.removeEventListener(listenerId!);
                }
            });

            it("Cannot Redeem USDC (Swap Time Limit Not Exceeded)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff: 0,
                            relayingFee: 0n,
                        },
                        amountIn,
                    },
                );

                await createAta(connection, payer, swapLayer.usdcMint, recipient);

                const transferIx = await swapLayer.completeTransferRelayIx(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                    },
                    toChainId("Ethereum"),
                );

                await expectIxErr(connection, [transferIx], [payer], "SwapTimeLimitNotExceeded");

                // Update the swap time limit to 0 seconds so that the following tests run quickly.
                const ix = await swapLayer.updateRelayParamsIx(
                    {
                        feeUpdater: feeUpdater.publicKey,
                    },
                    {
                        chain: toChainId("Ethereum"),
                        relayParams: {
                            ...TEST_RELAY_PARAMS,
                            swapTimeLimit: { fastLimit: 0, finalizedLimit: 0 },
                        },
                    },
                );

                await expectIxOk(swapLayer.program.provider.connection, [ix], [feeUpdater]);
            });

            it("Cannot Swap (Invalid Redeem Mode)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: { mode: "Direct" },
                        amountIn,
                    },
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient: recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee: 0n,
                        denormGasDropoff: 0n,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "InvalidRedeemMode",
                    },
                );
            });

            it("Cannot Swap (Invalid Destination Mint)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff: 0,
                            relayingFee: 0n,
                        },
                        amountIn,
                    },
                );

                const recipientToken = await createAta(
                    connection,
                    payer,
                    swapLayer.usdcMint,
                    recipient,
                );

                // Pass in the wrong destination mint.
                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient: recipient,
                        dstMint: swapLayer.usdcMint,
                        recipientToken,
                    },
                    {
                        limitAmount,
                        relayingFee: 0n,
                        denormGasDropoff: 0n,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "InvalidDestinationMint",
                    },
                );
            });

            it("Cannot Swap (Exceeds Swap Deadline)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    deadline: 1, // Set the deadline to 1 second.
                    slippageBps: 100,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff: 0,
                            relayingFee: 0n,
                        },
                        amountIn,
                    },
                );

                // Pass in the wrong destination mint.
                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient: recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee: 0n,
                        denormGasDropoff: 0n,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "SwapPastDeadline",
                    },
                );
            });

            it("Cannot Swap (Invalid Limit Amount)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000_000_000_000_000_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff: 0,
                            relayingFee: 0n,
                        },
                        amountIn,
                    },
                );

                // Pass in the wrong destination mint.
                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient: recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee: 0n,
                        denormGasDropoff: 0n,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "InvalidLimitAmount",
                    },
                );
            });

            it("Cannot Swap (Same Mint)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint: USDC_MINT_ADDRESS,
                    slippageBps: 100,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff: 0,
                            relayingFee: 0n,
                        },
                        amountIn,
                    },
                );

                const recipientToken = await createAta(
                    connection,
                    payer,
                    swapLayer.usdcMint,
                    recipient,
                );

                // Pass in the wrong destination mint.
                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient: recipient,
                        dstMint: USDC_MINT_ADDRESS,
                        recipientToken,
                    },
                    {
                        limitAmount,
                        relayingFee: 0n,
                        denormGasDropoff: 0n,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "SameMint",
                    },
                );
            });

            it("Cannot Swap (Invalid Recipient ATA)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff: 0,
                            relayingFee: 0n,
                        },
                        amountIn,
                    },
                );

                // Pass in payer token account instead.
                const payerToken = splToken.getAssociatedTokenAddressSync(
                    swapLayer.usdcMint,
                    payer.publicKey,
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient: recipient,
                        recipientToken: payerToken,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee: 0n,
                        denormGasDropoff: 0n,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "recipient_token. Error Code: ConstraintAddress",
                    },
                );
            });

            it("Cannot Swap (Invalid Fee Recipient)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff: 0,
                            relayingFee: 0n,
                        },
                        amountIn,
                    },
                );

                // Pass in payer token account instead.
                const recipientToken = await createAta(
                    connection,
                    payer,
                    swapLayer.usdcMint,
                    recipient,
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient: recipient,
                        feeRecipientToken: recipientToken,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee: 0n,
                        denormGasDropoff: 0n,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "fee_recipient_token. Error Code: ConstraintAddress",
                    },
                );
            });

            it("Cannot Swap (Invalid Recipient)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff: 0,
                            relayingFee: 0n,
                        },
                        amountIn,
                        recipientOverride: feeUpdater.publicKey,
                    },
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient: recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee: 0n,
                        denormGasDropoff: 0n,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "InvalidRecipient",
                    },
                );
            });

            it("Other (USDT) via Whirlpool", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const gasDropoff = 100_000; // .1 SOL (10,000 * 1e3)
                const relayingFee = 690000n; // .69 USDC
                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            relayingFee,
                        },
                        amountIn,
                    },
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee,
                        denormGasDropoff: denormalizeGasDropOff(gasDropoff),
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                    },
                );
            });

            it("Other (USDT) via Whirlpool (No Relayer Fee)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const gasDropoff = 100_000; // .1 SOL (10,000 * 1e3)
                const relayingFee = 0n;
                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            relayingFee,
                        },
                        amountIn,
                    },
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee,
                        denormGasDropoff: denormalizeGasDropOff(gasDropoff),
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                    },
                );
            });

            it("Other (USDT) via Whirlpool (No Relayer Fee Or Gas Dropoff)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const gasDropoff = 0;
                const relayingFee = 0n;
                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            relayingFee,
                        },
                        amountIn,
                    },
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee,
                        denormGasDropoff: denormalizeGasDropOff(gasDropoff),
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                    },
                );
            });

            it("Other (USDT) via Whirlpool (Self Redeem)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const gasDropoff = 100_000; // .1 SOL (10,000 * 1e3)
                const relayingFee = 690000n; // .69 USDC
                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        recipient: testRecipient.publicKey,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            relayingFee,
                        },
                        amountIn,
                    },
                );

                // Use recipient as the payer.
                await completeSwapRelayForTest(
                    {
                        payer: recipient,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee,
                        denormGasDropoff: denormalizeGasDropOff(gasDropoff),
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                    },
                    { signers: [testRecipient] },
                );
            });

            it("Other (WSOL) via Phoenix V1", async function () {
                const dstMint = splToken.NATIVE_MINT;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 2_000_000_000n,
                    dstMint,
                    slippageBps: 150,
                });

                const gasDropoff = 100_000; // .1 SOL (10,000 * 1e3)
                const relayingFee = 690000n; // .69 USDC
                const amountIn = 300_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            relayingFee,
                        },
                        amountIn,
                    },
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee,
                        denormGasDropoff: denormalizeGasDropOff(gasDropoff),
                        swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                    },
                );
            });

            it("Other (WSOL) via Phoenix V1 (Self Redeem)", async function () {
                const dstMint = splToken.NATIVE_MINT;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 2_000_000_000n,
                    dstMint,
                    slippageBps: 150,
                });

                const gasDropoff = 100_000; // .1 SOL (10,000 * 1e3)
                const relayingFee = 690000n; // .69 USDC
                const amountIn = 300_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        recipient: testRecipient.publicKey,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            relayingFee,
                        },
                        amountIn,
                    },
                );

                await completeSwapRelayForTest(
                    {
                        payer: recipient,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee,
                        denormGasDropoff: denormalizeGasDropOff(gasDropoff),
                        swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                    },
                    { signers: [testRecipient] },
                );
            });

            it("Gas via Phoenix V1", async function () {
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 2_000_000_000n,
                    slippageBps: 150,
                });

                const gasDropoff = 100_000; // .1 SOL (10,000 * 1e3)
                const relayingFee = 690000n; // .69 USDC
                const amountIn = 300_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            relayingFee,
                        },
                        amountIn,
                    },
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                    },
                    {
                        limitAmount,
                        relayingFee,
                        denormGasDropoff: denormalizeGasDropOff(gasDropoff),
                        swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                    },
                );
            });

            it("Gas via Phoenix V1 (No Relayer Fee)", async function () {
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 2_000_000_000n,
                    slippageBps: 150,
                });

                const gasDropoff = 100_000; // .1 SOL (10,000 * 1e3)
                const relayingFee = 0n;
                const amountIn = 300_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            relayingFee,
                        },
                        amountIn,
                    },
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                    },
                    {
                        limitAmount,
                        relayingFee,
                        denormGasDropoff: denormalizeGasDropOff(gasDropoff),
                        swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                    },
                );
            });

            it("Gas via Phoenix V1 (No Relayer Fee Or Gas Dropoff)", async function () {
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 2_000_000_000n,
                    slippageBps: 150,
                });

                const gasDropoff = 0;
                const relayingFee = 0n;
                const amountIn = 300_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            relayingFee,
                        },
                        amountIn,
                    },
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                    },
                    {
                        limitAmount,
                        relayingFee,
                        denormGasDropoff: denormalizeGasDropOff(gasDropoff),
                        swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                    },
                );
            });

            it("Gas via Phoenix V1 (Self Redeem)", async function () {
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 2_000_000_000n,
                    slippageBps: 150,
                });

                const gasDropoff = 100_000; // .1 SOL (10,000 * 1e3)
                const relayingFee = 690000n; // .69 USDC
                const amountIn = 300_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        outputToken,
                        recipient: testRecipient.publicKey,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            relayingFee,
                        },
                        amountIn,
                    },
                    false,
                );

                await completeSwapRelayForTest(
                    {
                        payer: recipient,
                        preparedFill,
                        recipient,
                    },
                    {
                        limitAmount,
                        relayingFee,
                        denormGasDropoff: denormalizeGasDropOff(gasDropoff),
                        swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                    },
                    { signers: [testRecipient] },
                );
            });

            it("Redeem USDC (Failed Swap)", async function () {
                // NOTE: The fast limit is set to 0 seconds, so the USDC relay should be allowed
                // without any time constraints.
                const dstMint = USDT_MINT_ADDRESS;
                const { outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 100,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff: 0,
                            relayingFee: 0n,
                        },
                        amountIn,
                        initAuctionFee: 0n,
                        baseFee: 0n,
                    },
                );
                const beneficiary = Keypair.generate();

                // Create an ATA for the recipient.
                await expectIxOk(
                    connection,
                    [
                        splToken.createAssociatedTokenAccountInstruction(
                            payer.publicKey,
                            splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, recipient),
                            recipient,
                            USDC_MINT_ADDRESS,
                        ),
                    ],
                    [payer],
                );

                // Balance check.
                const recipientBefore = await getUsdcAtaBalance(connection, recipient);

                const transferIx = await swapLayer.completeTransferRelayIx(
                    {
                        payer: payer.publicKey,
                        beneficiary: beneficiary.publicKey,
                        preparedFill,
                        recipient: recipient,
                    },
                    toChainId("Ethereum"),
                );

                await expectIxOk(connection, [transferIx], [payer]);

                // Balance check.
                const recipientAfter = await getUsdcAtaBalance(connection, recipient);
                assert.equal(recipientAfter - recipientBefore, amountIn);
            });

            it("Other (Token-2022 Mint) via Multi-Route", async function () {
                const dstMint = BERN_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 200_000_000n,
                    dstMint,
                    slippageBps: 500,
                });

                const gasDropoff = 100_000; // .1 SOL (10,000 * 1e3)
                const relayingFee = 690000n; // .69 USDC
                const amountIn = preFillAmountIn(10_000_000n, relayingFee);
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            relayingFee,
                        },
                        amountIn,
                    },
                );

                await completeSwapRelayForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        relayingFee,
                        denormGasDropoff: denormalizeGasDropOff(gasDropoff),
                        swapResponseModifier: modifyUsdcTo2022SwapResponseForTest,
                        additionalLuts: JUPITER_V6_LUT_ADDRESSES_BERN,
                    },
                );
            });
        });
    });

    describe("USDC Swap (Direct)", function () {
        describe("Close Staged Outbound", function () {
            it("USDT", async function () {
                const amountIn = 690000n;
                const srcMint = USDT_MINT_ADDRESS;
                const senderToken = splToken.getAssociatedTokenAddressSync(
                    srcMint,
                    payer.publicKey,
                );

                // Stage outbound with sender.
                const { stagedOutbound, stagedCustodyToken } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken,
                        srcMint,
                    },
                    { amountIn },
                );

                const balanceBefore = await connection.getBalance(payer.publicKey).then(BigInt);
                const { amount: tokenBalanceBefore } = await splToken.getAccount(
                    connection,
                    senderToken,
                );

                const ix = await swapLayer.closeStagedOutboundIx(
                    { stagedOutbound, senderToken },
                    toChainId("Ethereum"),
                );
                await expectIxOk(connection, [ix], [payer]);

                const balanceAfter = await connection.getBalance(payer.publicKey).then(BigInt);
                const { amount: tokenBalanceAfter } = await splToken.getAccount(
                    connection,
                    senderToken,
                );

                assert.isTrue(balanceAfter > balanceBefore);
                assert.equal(tokenBalanceAfter, tokenBalanceBefore + amountIn);

                // Confirm that the staged accounts have been deleted.
                {
                    const accInfo = await connection.getAccountInfo(stagedOutbound);
                    assert.isNull(accInfo);
                }
                {
                    const accInfo = await connection.getAccountInfo(stagedCustodyToken);
                    assert.isNull(accInfo);
                }
            });

            it("Gas (Sender == Prepared By)", async function () {
                const amountIn = 690000n;

                // Stage outbound with sender.
                const { stagedOutbound, stagedCustodyToken } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: null,
                        sender: payer.publicKey,
                        srcMint: splToken.NATIVE_MINT,
                    },
                    { amountIn, minAmountOut: 1n, transferType: "native" },
                );

                const balanceBefore = await connection.getBalance(payer.publicKey).then(BigInt);

                const ix = await swapLayer.closeStagedOutboundIx(
                    { stagedOutbound, senderToken: null },
                    toChainId("Ethereum"),
                );
                await expectIxOk(connection, [ix], [payer]);

                // Confirm that the staged accounts have been deleted.
                {
                    const accInfo = await connection.getAccountInfo(stagedOutbound);
                    assert.isNull(accInfo);
                }
                {
                    const accInfo = await connection.getAccountInfo(stagedCustodyToken);
                    assert.isNull(accInfo);
                }

                const balanceAfter = await connection.getBalance(payer.publicKey).then(BigInt);

                assert.isTrue(balanceAfter - balanceBefore >= amountIn);
            });

            it("Gas (Sender != Prepared By)", async function () {
                const amountIn = 690000n;
                const stagedOutboundSigner = Keypair.generate();
                const stagedOutbound = stagedOutboundSigner.publicKey;
                const sender = feeUpdater;

                const usdcRefundToken = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    sender.publicKey,
                );
                await expectIxOk(
                    connection,
                    [
                        splToken.createAssociatedTokenAccountInstruction(
                            sender.publicKey,
                            usdcRefundToken,
                            sender.publicKey,
                            USDC_MINT_ADDRESS,
                        ),
                    ],
                    [sender],
                );
                const [approveIx, stageIx] = await swapLayer.stageOutboundIx(
                    {
                        payer: payer.publicKey,
                        senderToken: null,
                        sender: sender.publicKey,
                        stagedOutbound,
                        usdcRefundToken,
                    },
                    {
                        transferType: "native",
                        amountIn,
                        isExactIn: true,
                        minAmountOut: 1n,
                        targetChain: toChainId("Ethereum"),
                        recipient: Array.from(Buffer.alloc(32, "deadbeef")),
                        redeemOption: null,
                        outputToken: null,
                    },
                );
                assert.isNull(approveIx);

                await expectIxOk(connection, [stageIx], [payer, sender, stagedOutboundSigner]);

                const senderBefore = await connection.getBalance(sender.publicKey).then(BigInt);
                const preparedByBefore = await connection.getBalance(payer.publicKey).then(BigInt);

                const ix = await swapLayer.closeStagedOutboundIx(
                    { stagedOutbound, senderToken: null, sender: sender.publicKey },
                    toChainId("Ethereum"),
                );
                const tx = await expectIxOk(connection, [ix], [sender]);
                const txDetail = await connection.getParsedTransaction(tx, {
                    maxSupportedTransactionVersion: 0,
                    commitment: "confirmed",
                });

                // Confirm that the staged accounts have been deleted.
                {
                    const accInfo = await connection.getAccountInfo(stagedOutbound);
                    assert.isNull(accInfo);
                }
                {
                    const accInfo = await connection.getAccountInfo(
                        swapLayer.stagedCustodyTokenAddress(stagedOutbound),
                    );
                    assert.isNull(accInfo);
                }

                const senderAfter = await connection.getBalance(sender.publicKey).then(BigInt);
                const preparedByAfter = await connection.getBalance(payer.publicKey).then(BigInt);

                assert.isTrue(senderAfter - senderBefore == amountIn - BigInt(txDetail.meta.fee));
                assert.isTrue(preparedByAfter > preparedByBefore);
            });
        });

        describe("Outbound", function () {
            it("Cannot Swap (Min Amount Out Too Small)", async function () {
                const srcMint = USDT_MINT_ADDRESS;

                const { stagedOutbound, custodyBalance: inAmount } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                            false,
                            await whichTokenProgram(connection, srcMint),
                        ),
                        srcMint,
                    },
                    { minAmountOut: 9999999999999n },
                );

                const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);
                const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
                const {
                    instruction: cpiInstruction,
                    sourceMint,
                    destinationMint,
                } = await modifyUsdtToUsdcSwapResponseForTest(swapAuthority, {
                    inAmount,
                    quotedOutAmount: inAmount, // stable swap
                    slippageBps: 50,
                    cpi: true,
                });
                assert.deepEqual(sourceMint, srcMint);
                assert.deepEqual(destinationMint, swapLayer.usdcMint);

                const ix = await swapLayer.initiateSwapExactInIx(
                    {
                        payer: payer.publicKey,
                        stagedOutbound,
                        srcMint,
                    },
                    {
                        cpiInstruction,
                    },
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 360_000,
                });

                const addressLookupTableAccounts = await Promise.all(
                    luts.map(async (lookupTableAddress) => {
                        const resp = await connection.getAddressLookupTable(lookupTableAddress);
                        return resp.value;
                    }),
                );

                await expectIxErr(connection, [computeIx, ix], [payer], "InsufficientAmountOut", {
                    addressLookupTableAccounts,
                });
            });

            it("USDT via Whirlpool", async function () {
                const srcMint = USDT_MINT_ADDRESS;

                const {
                    stagedOutbound,
                    stagedCustodyToken,
                    custodyBalance: inAmount,
                    stagedOutboundInfo,
                    redeemMode,
                    outputToken,
                } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                            false,
                            await whichTokenProgram(connection, srcMint),
                        ),
                        srcMint,
                    },
                    { minAmountOut: 1n },
                );

                const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);
                const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
                const {
                    instruction: cpiInstruction,
                    sourceToken,
                    destinationToken,
                    sourceMint,
                    destinationMint,
                    minAmountOut,
                } = await modifyUsdtToUsdcSwapResponseForTest(swapAuthority, {
                    inAmount,
                    quotedOutAmount: inAmount, // stable swap
                    slippageBps: 50,
                    cpi: true,
                });
                assert.deepEqual(sourceMint, srcMint);
                assert.deepEqual(destinationMint, swapLayer.usdcMint);

                {
                    const accInfos = await connection.getMultipleAccountsInfo([
                        sourceToken,
                        destinationToken,
                    ]);
                    assert.isTrue(accInfos.every((info) => info === null));
                }

                const ix = await swapLayer.initiateSwapExactInIx(
                    {
                        payer: payer.publicKey,
                        stagedOutbound,
                        srcMint,
                    },
                    {
                        cpiInstruction,
                    },
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 360_000,
                });

                const addressLookupTableAccounts = await Promise.all(
                    luts.map(async (lookupTableAddress) => {
                        const resp = await connection.getAddressLookupTable(lookupTableAddress);
                        return resp.value;
                    }),
                );

                await expectIxOk(connection, [computeIx, ix], [payer], {
                    addressLookupTableAccounts,
                });

                {
                    const accInfos = await connection.getMultipleAccountsInfo([
                        sourceToken,
                        destinationToken,
                        stagedOutbound,
                        stagedCustodyToken,
                    ]);
                    assert.isTrue(accInfos.every((info) => info === null));
                }

                const { targetChain, usdcRefundToken, recipient } = stagedOutboundInfo;
                const { address: redeemer } = await swapLayer.fetchPeer(targetChain as ChainId);

                // Verify the relevant information in the prepared order.
                const preparedOrderData = await tokenRouter.fetchPreparedOrder(preparedOrder);

                const { info } = preparedOrderData;
                assert.deepEqual(
                    preparedOrderData,
                    new tokenRouterSdk.PreparedOrder(
                        {
                            orderSender: swapLayer.custodianAddress(),
                            preparedBy: payer.publicKey,
                            orderType: {
                                market: {
                                    minAmountOut: null,
                                },
                            },
                            srcToken: destinationToken,
                            refundToken: usdcRefundToken,
                            targetChain,
                            redeemer,
                            preparedCustodyTokenBump: info.preparedCustodyTokenBump,
                        },
                        Buffer.from(
                            encodeSwapLayerMessage({
                                recipient: new UniversalAddress(Uint8Array.from(recipient)),
                                redeemMode,
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
                assert.isTrue(preparedCustodyTokenBalance >= minAmountOut);
            });
        });

        describe("Inbound", function () {
            const emittedEvents: EmittedFilledLocalFastOrder[] = [];
            let listenerId: number | null;

            before("Start Event Listener", async function () {
                listenerId = matchingEngine.onFilledLocalFastOrder((event, slot, signature) => {
                    emittedEvents.push({ event, slot, signature });
                });
            });

            after("Stop Event Listener", async function () {
                if (listenerId !== null) {
                    matchingEngine.program.removeEventListener(listenerId!);
                }
            });

            it("Cannot Swap (Invalid Recipient ATA)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 15,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        amountIn,
                    },
                );

                // Pass in payer token account instead.
                const payerToken = splToken.getAssociatedTokenAddressSync(
                    swapLayer.usdcMint,
                    payer.publicKey,
                );

                await completeSwapDirectForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                        recipientToken: payerToken,
                        dstMint,
                    },
                    {
                        limitAmount,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "recipient_token. Error Code: ConstraintAddress",
                    },
                );
            });

            it("Cannot Swap (Invalid Redeem Mode)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 15,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode: {
                            mode: "Payload",
                            sender: toUniversal(
                                "Ethereum",
                                "0x000000000000000000000000000000000000d00d",
                            ),
                            buf: Buffer.from("All your base are belong to us."),
                        },
                        amountIn,
                    },
                );

                await completeSwapDirectForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "InvalidRedeemMode",
                    },
                );
            });

            it("Cannot Swap USDC Override (Invalid Recipient)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 15,
                });
                const outputToken: OutputToken = { type: "Usdc" };

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        amountIn,
                    },
                );

                await completeSwapDirectForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        outputTokenOverride: "Other",
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "InvalidRecipient",
                    },
                );
            });

            it("Cannot Swap USDC Override (Invalid Redeem Mode)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const quotedAmountOut = 198_800_000n;
                const { limitAmount } = newQuotedSwapOutputToken({
                    quotedAmountOut,
                    dstMint,
                    slippageBps: 15,
                });
                const outputToken: OutputToken = { type: "Usdc" };
                const redeemMode: RedeemMode = {
                    mode: "Payload",
                    sender: toUniversal("Ethereum", "0x000000000000000000000000000000000000d00d"),
                    buf: Buffer.from("All your base are belong to us."),
                };

                const amountIn = 200_000_000n;
                const { preparedFill } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        redeemMode,
                        amountIn,
                        recipient: payer.publicKey,
                    },
                    false,
                );

                // Fetch amount from prepared fill.
                const preparedData = await tokenRouter.preparedCustodyTokenAddress(preparedFill);
                const { amount: custodyAmount } = await splToken.getAccount(
                    connection,
                    preparedData,
                );

                await completeSwapDirectForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient: payer.publicKey,
                        dstMint,
                    },
                    {
                        limitAmount,
                        outputTokenOverride: "Other",
                        inAmount: custodyAmount,
                        quotedAmountOut,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "InvalidRedeemMode",
                    },
                );
            });

            it("Cannot Swap USDC Override (Invalid Swap In Amount)", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const quotedAmountOut = 198_800_000n;
                const { limitAmount } = newQuotedSwapOutputToken({
                    quotedAmountOut,
                    dstMint,
                    slippageBps: 15,
                });
                const outputToken: OutputToken = { type: "Usdc" };

                const amountIn = 200_000_000n;
                const { preparedFill } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        amountIn,
                        recipient: payer.publicKey,
                    },
                    false,
                );

                // NOTE: Don't modify the inAmount.
                await completeSwapDirectForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient: payer.publicKey,
                        dstMint,
                    },
                    {
                        limitAmount,
                        outputTokenOverride: "Other",
                        quotedAmountOut,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        errorMsg: "InvalidSwapInAmount",
                    },
                );
            });

            it("Other (USDT) USDC Override", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const quotedAmountOut = 198_800_000n;
                const { limitAmount } = newQuotedSwapOutputToken({
                    quotedAmountOut,
                    dstMint,
                    slippageBps: 15,
                });
                const outputToken: OutputToken = { type: "Usdc" };

                const amountIn = 200_000_000n;
                const { preparedFill } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        amountIn,
                        recipient: payer.publicKey,
                    },
                    false,
                );

                // Fetch amount from prepared fill.
                const preparedData = await tokenRouter.preparedCustodyTokenAddress(preparedFill);
                const { amount: custodyAmount } = await splToken.getAccount(
                    connection,
                    preparedData,
                );

                await completeSwapDirectForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient: payer.publicKey,
                        dstMint,
                    },
                    {
                        limitAmount,
                        outputTokenOverride: "Other",
                        inAmount: custodyAmount,
                        quotedAmountOut,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                    },
                );
            });

            it("Other (USDT) via Whirlpool", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 15,
                });

                const amountIn = 200_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        amountIn,
                    },
                );

                await completeSwapDirectForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                    },
                );
            });

            it("Other (WSOL) via Phoenix V1", async function () {
                const dstMint = splToken.NATIVE_MINT;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 2_000_000_000n,
                    dstMint,
                    slippageBps: 150,
                });

                const amountIn = 300_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        amountIn,
                    },
                );

                await completeSwapDirectForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                    },
                );
            });

            it("Gas via Phoenix V1", async function () {
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 2_000_000_000n,
                    slippageBps: 150,
                });

                const amountIn = 300_000_000n;
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        outputToken,
                        amountIn,
                    },
                );

                await completeSwapDirectForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                    },
                    {
                        limitAmount,
                        swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                    },
                );
            });

            it("Other (Token-2022 Mint) via Multi-Route", async function () {
                const dstMint = BERN_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 200_000_000n,
                    dstMint,
                    slippageBps: 500,
                });

                const amountIn = preFillAmountIn(10_000_000n);
                const { preparedFill, recipient } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        outputToken,
                        amountIn,
                    },
                );

                await completeSwapDirectForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        recipient,
                        dstMint,
                    },
                    {
                        limitAmount,
                        swapResponseModifier: modifyUsdcTo2022SwapResponseForTest,
                        additionalLuts: JUPITER_V6_LUT_ADDRESSES_BERN,
                    },
                );
            });
        });
    });

    describe("USDC Swap (Payload)", function () {
        describe("Outbound", function () {
            it("USDT via Whirlpool", async function () {
                const srcMint = USDT_MINT_ADDRESS;

                const {
                    stagedOutbound,
                    stagedCustodyToken,
                    custodyBalance: inAmount,
                    stagedOutboundInfo,
                    redeemMode,
                    outputToken,
                } = await stageOutboundForTest(
                    {
                        payer: payer.publicKey,
                        senderToken: splToken.getAssociatedTokenAddressSync(
                            srcMint,
                            payer.publicKey,
                            false,
                            await whichTokenProgram(connection, srcMint),
                        ),
                        srcMint,
                    },
                    {
                        minAmountOut: 1n,
                        redeemOption: {
                            payload: Buffer.from("All your base are belong to us."),
                        },
                    },
                );

                const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);
                const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
                const {
                    instruction: cpiInstruction,
                    sourceToken,
                    destinationToken,
                    sourceMint,
                    destinationMint,
                    minAmountOut,
                } = await modifyUsdtToUsdcSwapResponseForTest(swapAuthority, {
                    inAmount,
                    quotedOutAmount: inAmount, // stable swap
                    slippageBps: 50,
                    cpi: true,
                });
                assert.deepEqual(sourceMint, srcMint);
                assert.deepEqual(destinationMint, swapLayer.usdcMint);

                {
                    const accInfos = await connection.getMultipleAccountsInfo([
                        sourceToken,
                        destinationToken,
                    ]);
                    assert.isTrue(accInfos.every((info) => info === null));
                }

                const ix = await swapLayer.initiateSwapExactInIx(
                    {
                        payer: payer.publicKey,
                        stagedOutbound,
                        srcMint,
                    },
                    {
                        cpiInstruction,
                    },
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 360_000,
                });

                const addressLookupTableAccounts = await Promise.all(
                    luts.map(async (lookupTableAddress) => {
                        const resp = await connection.getAddressLookupTable(lookupTableAddress);
                        return resp.value;
                    }),
                );

                await expectIxOk(connection, [computeIx, ix], [payer], {
                    addressLookupTableAccounts,
                });

                {
                    const accInfos = await connection.getMultipleAccountsInfo([
                        sourceToken,
                        destinationToken,
                        stagedOutbound,
                        stagedCustodyToken,
                    ]);
                    assert.isTrue(accInfos.every((info) => info === null));
                }

                const { targetChain, usdcRefundToken, recipient } = stagedOutboundInfo;
                const { address: redeemer } = await swapLayer.fetchPeer(targetChain as ChainId);

                // Verify the relevant information in the prepared order.
                const preparedOrderData = await tokenRouter.fetchPreparedOrder(preparedOrder);

                const { info } = preparedOrderData;
                assert.deepEqual(
                    preparedOrderData,
                    new tokenRouterSdk.PreparedOrder(
                        {
                            orderSender: swapLayer.custodianAddress(),
                            preparedBy: payer.publicKey,
                            orderType: {
                                market: {
                                    minAmountOut: null,
                                },
                            },
                            srcToken: destinationToken,
                            refundToken: usdcRefundToken,
                            targetChain,
                            redeemer,
                            preparedCustodyTokenBump: info.preparedCustodyTokenBump,
                        },
                        Buffer.from(
                            encodeSwapLayerMessage({
                                recipient: new UniversalAddress(Uint8Array.from(recipient)),
                                redeemMode,
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
                assert.isTrue(preparedCustodyTokenBalance >= minAmountOut);
            });
        });

        describe("Inbound", function () {
            const emittedEvents: EmittedFilledLocalFastOrder[] = [];
            let listenerId: number | null;

            before("Start Event Listener", async function () {
                listenerId = matchingEngine.onFilledLocalFastOrder((event, slot, signature) => {
                    emittedEvents.push({ event, slot, signature });
                });
            });

            after("Stop Event Listener", async function () {
                if (listenerId !== null) {
                    matchingEngine.program.removeEventListener(listenerId!);
                }
            });

            it("Other (USDT) via Whirlpool", async function () {
                const dstMint = USDT_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 198_800_000n,
                    dstMint,
                    slippageBps: 15,
                });

                const amountIn = 200_000_000n;
                const { preparedFill } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        redeemMode: {
                            mode: "Payload",
                            sender: toUniversal(
                                "Ethereum",
                                "0x000000000000000000000000000000000000d00d",
                            ),
                            buf: Buffer.from("All your base are belong to us."),
                        },
                        outputToken,
                        amountIn,
                    },
                );

                await completeSwapPayloadForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        dstMint,
                    },
                    {
                        limitAmount,
                        swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                    },
                );
            });

            it("Other (WSOL) via Phoenix V1", async function () {
                const dstMint = splToken.NATIVE_MINT;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 2_000_000_000n,
                    dstMint,
                    slippageBps: 150,
                });

                const amountIn = 300_000_000n;
                const { preparedFill } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        redeemMode: {
                            mode: "Payload",
                            sender: toUniversal(
                                "Ethereum",
                                "0x000000000000000000000000000000000000d00d",
                            ),
                            buf: Buffer.from("All your base are belong to us."),
                        },
                        outputToken,
                        amountIn,
                    },
                );

                await completeSwapPayloadForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        dstMint,
                    },
                    {
                        limitAmount,
                        swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                    },
                );
            });

            it("Gas via Phoenix V1", async function () {
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 2_000_000_000n,
                    slippageBps: 150,
                });

                const amountIn = 300_000_000n;
                const { preparedFill } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        outputToken,
                        redeemMode: {
                            mode: "Payload",
                            sender: toUniversal(
                                "Ethereum",
                                "0x000000000000000000000000000000000000d00d",
                            ),
                            buf: Buffer.from("All your base are belong to us."),
                        },
                        amountIn,
                    },
                );

                await completeSwapPayloadForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                    },
                    {
                        limitAmount,
                        swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                    },
                );
            });

            it("Other (Token-2022 Mint) via Multi-Route", async function () {
                const dstMint = BERN_MINT_ADDRESS;
                const { limitAmount, outputToken } = newQuotedSwapOutputToken({
                    quotedAmountOut: 200_800_000n,
                    dstMint,
                    slippageBps: 500,
                });

                const amountIn = preFillAmountIn(10_000_000n);
                const { preparedFill } = await redeemSwapLayerFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        dstMint,
                        redeemMode: {
                            mode: "Payload",
                            sender: toUniversal(
                                "Ethereum",
                                "0x000000000000000000000000000000000000d00d",
                            ),
                            buf: Buffer.from("All your base are belong to us."),
                        },
                        outputToken,
                        amountIn,
                    },
                );

                await completeSwapPayloadForTest(
                    {
                        payer: payer.publicKey,
                        preparedFill,
                        dstMint,
                    },
                    {
                        limitAmount,
                        swapResponseModifier: modifyUsdcTo2022SwapResponseForTest,
                        additionalLuts: JUPITER_V6_LUT_ADDRESSES_BERN,
                    },
                );
            });
        });
    });

    function newQuotedSwapOutputToken(opts: {
        quotedAmountOut: bigint;
        dstMint?: PublicKey | null;
        slippageBps?: number;
        deadline?: number;
        dexProgramId?: PublicKey | null;
    }) {
        const { quotedAmountOut } = opts;

        let { dstMint, slippageBps, deadline, dexProgramId } = opts;
        dstMint ??= null;
        slippageBps ??= 0;
        deadline ??= 0;
        dexProgramId ??= null;

        const limitAmount = (quotedAmountOut * (10000n - BigInt(slippageBps))) / 10000n;
        const swap = {
            deadline,
            limitAmount,
            type: {
                id: "JupiterV6",
                dexProgramId:
                    dexProgramId === null
                        ? { isSome: false }
                        : {
                              isSome: true,
                              address: toUniversal("Solana", dexProgramId.toString()),
                          },
            },
        };
        return {
            limitAmount,
            outputToken: (dstMint === null
                ? { type: "Gas", swap }
                : {
                      type: "Other",
                      address: toUniversal("Solana", dstMint.toString()),
                      swap,
                  }) as OutputToken,
        };
    }

    async function completeSwapDirectForTest(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            recipient: PublicKey;
            recipientToken?: PublicKey;
            dstMint?: PublicKey;
        },
        opts: ForTestOpts & {
            limitAmount: bigint;
            outputTokenOverride?: string;
            inAmount?: bigint;
            quotedAmountOut?: bigint;
            swapResponseModifier: (
                tokenOwner: PublicKey,
                opts: jupiterV6.ModifySharedAccountsRouteOpts,
            ) => Promise<jupiterV6.ModifiedSharedAccountsRoute>;
            additionalLuts?: PublicKey[];
        },
    ): Promise<undefined> {
        const [{ signers, errorMsg }, otherOpts] = setDefaultForTestOpts(opts);
        const { limitAmount, outputTokenOverride, swapResponseModifier } = otherOpts;

        let { additionalLuts } = otherOpts;
        additionalLuts ??= [];

        const { instruction: cpiInstruction, destinationMint } = await swapResponseModifier(
            swapLayer.swapAuthorityAddress(accounts.preparedFill),
            {
                cpi: true,
                inAmount: opts.inAmount,
                quotedOutAmount: opts.quotedAmountOut,
            },
        );
        const expectedDstMint = accounts.dstMint ?? splToken.NATIVE_MINT;
        assert.deepEqual(destinationMint, expectedDstMint);

        const ix = await swapLayer.completeSwapDirectIx(accounts, { cpiInstruction });

        const ixs = [
            ComputeBudgetProgram.setComputeUnitLimit({
                units: 750_000,
            }),
            ix,
        ];

        const addressLookupTableAccounts = await Promise.all(
            [...luts, ...additionalLuts].map(async (lookupTableAddress) => {
                const resp = await connection.getAddressLookupTable(lookupTableAddress);
                return resp.value;
            }),
        );

        if (errorMsg !== null) {
            await expectIxErr(connection, ixs, signers, errorMsg, {
                addressLookupTableAccounts,
            });
            return;
        }

        const { redeemerMessage } = await tokenRouter.fetchPreparedFill(accounts.preparedFill);
        const outputToken = decodeSwapLayerMessage(redeemerMessage).outputToken;

        if (outputToken.type === "Gas" || outputTokenOverride === "Gas") {
            const balanceBefore = await connection.getBalance(accounts.recipient).then(BigInt);

            await expectIxOk(connection, ixs, signers, {
                addressLookupTableAccounts,
            });

            const balanceAfter = await connection.getBalance(accounts.recipient).then(BigInt);
            assert.isTrue(balanceAfter - balanceBefore >= limitAmount);
        } else if (outputToken.type === "Other" || outputTokenOverride === "Other") {
            const tokenProgram = await whichTokenProgram(connection, expectedDstMint);
            const dstToken = splToken.getAssociatedTokenAddressSync(
                expectedDstMint,
                accounts.recipient,
                false,
                tokenProgram,
            );
            const { amount: dstBalanceBefore } = await splToken.getAccount(
                connection,
                dstToken,
                undefined,
                tokenProgram,
            );

            await expectIxOk(connection, ixs, signers, {
                addressLookupTableAccounts,
            });

            const { amount: dstBalanceAfter } = await splToken.getAccount(
                connection,
                dstToken,
                undefined,
                tokenProgram,
            );
            assert.isTrue(dstBalanceAfter - dstBalanceBefore >= limitAmount);
        } else {
            assert.fail("Invalid output token type");
        }
    }

    async function completeSwapRelayForTest(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            recipient: PublicKey;
            feeRecipientToken?: PublicKey;
            recipientToken?: PublicKey;
            dstMint?: PublicKey;
        },
        opts: ForTestOpts & {
            limitAmount: bigint;
            relayingFee: bigint;
            denormGasDropoff: bigint;
            swapResponseModifier: (
                tokenOwner: PublicKey,
                opts: jupiterV6.ModifySharedAccountsRouteOpts,
            ) => Promise<jupiterV6.ModifiedSharedAccountsRoute>;
            additionalLuts?: PublicKey[];
        },
        overrides?: { signers: Signer[] },
    ): Promise<undefined> {
        const [{ signers, errorMsg }, otherOpts] = setDefaultForTestOpts(opts, overrides);
        const { limitAmount, relayingFee, denormGasDropoff, swapResponseModifier } = otherOpts;

        let { additionalLuts } = otherOpts;
        additionalLuts ??= [];

        const { instruction: cpiInstruction, destinationMint } = await swapResponseModifier(
            swapLayer.swapAuthorityAddress(accounts.preparedFill),
            {
                cpi: true,
            },
        );
        const expectedDstMint = accounts.dstMint ?? splToken.NATIVE_MINT;

        const ix = await swapLayer.completeSwapRelayIx(accounts, { cpiInstruction });

        const ixs = [
            ComputeBudgetProgram.setComputeUnitLimit({
                units: 750_000,
            }),
            ix,
        ];

        const addressLookupTableAccounts = await Promise.all(
            [...luts, ...additionalLuts].map(async (lookupTableAddress) => {
                const resp = await connection.getAddressLookupTable(lookupTableAddress);
                return resp.value;
            }),
        );

        if (errorMsg !== null) {
            await expectIxErr(connection, ixs, signers, errorMsg, {
                addressLookupTableAccounts,
            });
            return;
        }

        const { redeemerMessage } = await tokenRouter.fetchPreparedFill(accounts.preparedFill);
        const swapMsg = decodeSwapLayerMessage(redeemerMessage);
        const selfRedeem = accounts.payer == accounts.recipient;

        // Fetch the balance of the fee recipient before the swap.
        const { feeRecipientToken } = await swapLayer.fetchCustodian();
        const { amount: feeRecipientBefore } = await splToken.getAccount(
            connection,
            feeRecipientToken,
        );

        if (swapMsg.outputToken.type === "Gas") {
            const balanceBefore = await connection.getBalance(accounts.recipient).then(BigInt);

            await expectIxOk(connection, ixs, signers, {
                addressLookupTableAccounts,
            });

            const balanceAfter = await connection.getBalance(accounts.recipient).then(BigInt);
            assert.isTrue(
                balanceAfter - balanceBefore >=
                    (selfRedeem ? limitAmount : limitAmount + denormGasDropoff),
            );
        } else if (swapMsg.outputToken.type === "Other") {
            const dstTokenProgram = await whichTokenProgram(connection, expectedDstMint);
            const dstToken = splToken.getAssociatedTokenAddressSync(
                expectedDstMint,
                accounts.recipient,
                false,
                dstTokenProgram,
            );
            const { amount: dstBalanceBefore } = await splToken.getAccount(
                connection,
                dstToken,
                undefined,
                dstTokenProgram,
            );
            const balanceBefore = await connection.getBalance(accounts.recipient).then(BigInt);

            await expectIxOk(connection, ixs, signers, {
                addressLookupTableAccounts,
            });

            const { amount: dstBalanceAfter } = await splToken.getAccount(
                connection,
                dstToken,
                undefined,
                dstTokenProgram,
            );

            assert.isTrue(dstBalanceAfter - dstBalanceBefore >= limitAmount);

            const balanceAfter = await connection.getBalance(accounts.recipient).then(BigInt);
            if (!selfRedeem) {
                assert.isTrue(balanceAfter - balanceBefore == denormGasDropoff);
            } else {
                // Should be nonzero since token accounts are closed and lamports are sent to
                // the payer.
                assert.isTrue(balanceAfter - balanceBefore > 0);
            }
        } else {
            assert.fail("Invalid output token type");
        }

        const { amount: feeRecipientAfter } = await splToken.getAccount(
            connection,
            feeRecipientToken,
        );
        assert.equal(feeRecipientAfter - feeRecipientBefore, selfRedeem ? 0 : relayingFee);
    }

    async function completeSwapPayloadForTest(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            dstMint?: PublicKey;
        },
        opts: ForTestOpts & {
            limitAmount: bigint;
            swapResponseModifier: (
                tokenOwner: PublicKey,
                opts: jupiterV6.ModifySharedAccountsRouteOpts,
            ) => Promise<jupiterV6.ModifiedSharedAccountsRoute>;
            additionalLuts?: PublicKey[];
        },
    ): Promise<undefined> {
        const [{ signers, errorMsg }, otherOpts] = setDefaultForTestOpts(opts);
        const { limitAmount, swapResponseModifier } = otherOpts;

        let { additionalLuts } = otherOpts;
        additionalLuts ??= [];

        const stagedInbound = swapLayer.stagedInboundAddress(accounts.preparedFill);
        const {
            instruction: cpiInstruction,
            destinationMint,
            destinationToken,
        } = await swapResponseModifier(stagedInbound, {
            cpi: true,
        });

        const expectedDstMint = accounts.dstMint ?? splToken.NATIVE_MINT;
        assert.deepEqual(destinationMint, expectedDstMint);
        assert.deepEqual(
            destinationToken,
            splToken.getAssociatedTokenAddressSync(
                expectedDstMint,
                stagedInbound,
                true,
                await whichTokenProgram(connection, expectedDstMint),
            ),
        );

        const ix = await swapLayer.completeSwapPayloadIx(accounts, { cpiInstruction });

        const ixs = [
            ComputeBudgetProgram.setComputeUnitLimit({
                units: 750_000,
            }),
            ix,
        ];

        const addressLookupTableAccounts = await Promise.all(
            [...luts, ...additionalLuts].map(async (lookupTableAddress) => {
                const resp = await connection.getAddressLookupTable(lookupTableAddress);
                return resp.value;
            }),
        );

        if (errorMsg !== null) {
            await expectIxErr(connection, ixs, signers, errorMsg, {
                addressLookupTableAccounts,
            });
            return;
        }

        const { info: preparedFillInfo, redeemerMessage } = await tokenRouter.fetchPreparedFill(
            accounts.preparedFill,
        );

        await expectIxOk(connection, ixs, signers, {
            addressLookupTableAccounts,
        });

        const { recipient, redeemMode, outputToken } = decodeSwapLayerMessage(redeemerMessage);
        if (redeemMode.mode !== "Payload") {
            assert.fail("Not in payload mode");
        }

        const stagedInboundData = await swapLayer.fetchStagedInbound(stagedInbound);
        const { seeds } = stagedInboundData;
        assert.deepEqual(
            stagedInboundData,
            new StagedInbound(
                { preparedFill: accounts.preparedFill, bump: seeds.bump },
                {
                    custodyToken: destinationToken,
                    stagedBy: accounts.payer,
                    sourceChain: preparedFillInfo.sourceChain,
                    sender: Array.from(
                        toUniversal(
                            "Ethereum",
                            "0x000000000000000000000000000000000000d00d",
                        ).toUint8Array(),
                    ),
                    recipient: toNative("Solana", recipient).address,
                    isNative: outputToken.type === "Gas",
                },
                Buffer.from(redeemMode.buf),
            ),
        );

        if (outputToken.type === "Gas" || outputToken.type === "Other") {
            const { amount } = await splToken.getAccount(
                connection,
                destinationToken,
                undefined,
                await whichTokenProgram(connection, expectedDstMint),
            );
            assert.isTrue(amount >= limitAmount);
        } else {
            assert.fail("Invalid output token type");
        }
    }

    async function redeemSwapLayerFastFillForTest(
        accounts: { payer: PublicKey },
        emittedEvents: EmittedFilledLocalFastOrder[],
        opts: ObserveCctpOrderVaasOpts & {
            dstMint?: PublicKey;
            recipient?: PublicKey;
            redeemMode?: RedeemMode;
            outputToken?: OutputToken;
            recipientOverride?: PublicKey;
        },
        createRecipientAta = true,
    ) {
        let { dstMint, recipient, redeemMode, outputToken } = opts;
        dstMint ??= splToken.NATIVE_MINT;
        recipient ??= Keypair.generate().publicKey;
        redeemMode ??= { mode: "Direct" };
        outputToken ??= {
            type: "Gas",
            swap: {
                deadline: 0,
                limitAmount: 0n,
                type: {
                    id: "JupiterV6",
                    dexProgramId: { isSome: false },
                },
            },
        };

        // Generate a new token account for recipient.
        if (createRecipientAta) {
            await createAta(connection, payer, dstMint, recipient);
        }

        let encodedRecipient = recipient;
        if (opts.recipientOverride !== undefined) {
            encodedRecipient = opts.recipientOverride;
        }

        const msg = {
            recipient: toUniversal("Solana", encodedRecipient.toString()),
            redeemMode,
            outputToken,
        } as SwapLayerMessage;

        // Override redeemer message if undefined.
        if (opts.redeemerMessage === undefined) {
            opts.redeemerMessage = encodeSwapLayerMessage(msg);
        }

        const settleResult = await settleAuctionNoneLocalForTest(
            { payer: payer.publicKey },
            emittedEvents,
            opts,
        );
        const {
            event: {
                seeds: { sourceChain, orderSender, sequence },
            },
        } = settleResult!;

        const fastFill = matchingEngine.fastFillAddress(
            toChainId(sourceChain),
            orderSender,
            sequence,
        );

        const ix = await tokenRouter.redeemFastFillIx({
            ...accounts,
            fastFill,
        });

        await expectIxOk(connection, [ix], [payer]);

        const preparedFill = tokenRouter.preparedFillAddress(fastFill);
        const { redeemerMessage } = await tokenRouter.fetchPreparedFill(preparedFill);
        assert.deepEqual(decodeSwapLayerMessage(redeemerMessage), msg);

        return { preparedFill, recipient };
    }

    async function modifyUsdcToUsdtSwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): Promise<jupiterV6.ModifiedSharedAccountsRoute> {
        const response = JSON.parse(
            fs.readFileSync(`${__dirname}/jupiterV6SwapResponses/whirlpool_usdc_to_usdt.json`, {
                encoding: "utf-8",
            }),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(
            connection,
            response,
            tokenOwner,
            opts,
        );
    }

    async function modifyUsdtToUsdcSwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): Promise<jupiterV6.ModifiedSharedAccountsRoute> {
        const response = JSON.parse(
            fs.readFileSync(`${__dirname}/jupiterV6SwapResponses/whirlpool_usdt_to_usdc.json`, {
                encoding: "utf-8",
            }),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(
            connection,
            response,
            tokenOwner,
            opts,
        );
    }

    async function modifyUsdcToWsolSwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): Promise<jupiterV6.ModifiedSharedAccountsRoute> {
        const response = JSON.parse(
            fs.readFileSync(`${__dirname}/jupiterV6SwapResponses/phoenix_v1_usdc_to_wsol.json`, {
                encoding: "utf-8",
            }),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(
            connection,
            response,
            tokenOwner,
            opts,
        );
    }

    async function modifyWsolToUsdcSwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): Promise<jupiterV6.ModifiedSharedAccountsRoute> {
        const response = JSON.parse(
            fs.readFileSync(`${__dirname}/jupiterV6SwapResponses/phoenix_v1_wsol_to_usdc.json`, {
                encoding: "utf-8",
            }),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(
            connection,
            response,
            tokenOwner,
            opts,
        );
    }

    async function modifyUsdcTo2022SwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): Promise<jupiterV6.ModifiedSharedAccountsRoute> {
        const response = JSON.parse(
            fs.readFileSync(`${__dirname}/jupiterV6SwapResponses/multi_usdc_to_2022.json`, {
                encoding: "utf-8",
            }),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(
            connection,
            response,
            tokenOwner,
            opts,
        );
    }

    async function modify2022ToUsdcSwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): Promise<jupiterV6.ModifiedSharedAccountsRoute> {
        const response = JSON.parse(
            fs.readFileSync(`${__dirname}/jupiterV6SwapResponses/multi_2022_to_usdc.json`, {
                encoding: "utf-8",
            }),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(
            connection,
            response,
            tokenOwner,
            opts,
        );
    }

    type PrepareOrderResponseForTestOptionalOpts = {
        args?: matchingEngineSdk.CctpMessageArgs;
    };

    async function prepareOrderResponseCctpForTest(
        accounts: {
            payer: PublicKey;
        },
        opts: ObserveCctpOrderVaasOpts & PrepareOrderResponseForTestOptionalOpts,
    ): Promise<
        | undefined
        | {
              fastVaa: PublicKey;
              finalizedVaa: PublicKey;
              args: matchingEngineSdk.CctpMessageArgs;
              preparedOrderResponse: PublicKey;
              prepareOrderResponseInstruction?: TransactionInstruction;
          }
    > {
        let { args } = opts;

        const { fastVaa, fastVaaAccount, finalizedVaa } = await (async () => {
            const { fast, finalized } = await observeCctpOrderVaas(opts);
            args ??= finalized!.cctp;

            return {
                fastVaa: fast.vaa,
                fastVaaAccount: fast.vaaAccount,
                finalizedVaa: finalized!.vaa,
            };
        })();

        const ix = await matchingEngine.prepareOrderResponseCctpIx(
            {
                payer: accounts.payer,
                fastVaa,
                finalizedVaa,
            },
            args!,
        );

        const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
            units: 280_000,
        });

        const addressLookupTableAccounts = await Promise.all(
            luts.map(async (lookupTableAddress) => {
                const { value } = await connection.getAddressLookupTable(lookupTableAddress);

                return value;
            }),
        );
        await expectIxOk(connection, [computeIx, ix], [payer], {
            addressLookupTableAccounts,
        });

        return {
            fastVaa,
            finalizedVaa,
            args: args!,
            preparedOrderResponse: matchingEngine.preparedOrderResponseAddress(
                fastVaaAccount.digest(),
            ),
        };
    }

    async function reserveFastFillSequenceNoAuctionForTest(
        accounts: {
            payer: PublicKey;
            fastVaa?: PublicKey;
            auction?: PublicKey;
            preparedOrderResponse?: PublicKey;
        },
        opts: ObserveCctpOrderVaasOpts,
    ): Promise<
        | undefined
        | {
              fastVaa: PublicKey;
              fastVaaAccount: VaaAccount;
              reservedSequence: PublicKey;
              finalizedVaa?: PublicKey;
              finalizedVaaAccount?: VaaAccount;
          }
    > {
        let preparedOrderResponse: PublicKey | undefined;
        const { fastVaa, fastVaaAccount, finalizedVaa, finalizedVaaAccount } = await (async () => {
            if (accounts.preparedOrderResponse === undefined) {
                const result = await prepareOrderResponseCctpForTest(
                    {
                        payer: accounts.payer,
                    },
                    opts,
                );
                const { fastVaa, finalizedVaa } = result!;
                preparedOrderResponse = result!.preparedOrderResponse;

                return {
                    fastVaa,
                    fastVaaAccount: await VaaAccount.fetch(connection, fastVaa),
                    finalizedVaa: finalizedVaa,
                    finalizedVaaAccount: await VaaAccount.fetch(connection, finalizedVaa),
                };
            } else if (accounts.fastVaa !== undefined) {
                preparedOrderResponse = accounts.preparedOrderResponse;
                return {
                    fastVaa: accounts.fastVaa,
                    fastVaaAccount: await VaaAccount.fetch(connection, accounts.fastVaa),
                };
            } else {
                throw new Error("fastVaa must be defined if preparedOrderResponse is defined");
            }
        })();

        const ix = await matchingEngine.reserveFastFillSequenceNoAuctionIx({
            ...accounts,
            fastVaa: accounts.fastVaa ?? fastVaa,
            preparedOrderResponse,
        });

        await expectIxOk(connection, [ix], [payer]);

        return {
            fastVaa,
            fastVaaAccount,
            reservedSequence: matchingEngine.reservedFastFillSequenceAddress(
                fastVaaAccount.digest(),
            ),
            finalizedVaa,
            finalizedVaaAccount,
        };
    }

    type EmittedFilledLocalFastOrder = {
        event: matchingEngineSdk.LocalFastOrderFilled;
        slot: number;
        signature: string;
    };

    async function settleAuctionNoneLocalForTest(
        accounts: {
            payer: PublicKey;
            reservedSequence?: PublicKey;
        },
        emittedEvents: EmittedFilledLocalFastOrder[],
        opts: ObserveCctpOrderVaasOpts,
    ): Promise<undefined | { event: matchingEngineSdk.LocalFastOrderFilled }> {
        const reserveResult = await reserveFastFillSequenceNoAuctionForTest(
            {
                payer: accounts.payer,
            },
            opts,
        );

        const ix = await matchingEngine.settleAuctionNoneLocalIx({
            ...accounts,
            reservedSequence: reserveResult!.reservedSequence,
        });

        await expectIxOk(connection, [ix], [payer]);

        // Check event.
        while (emittedEvents.length == 0) {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        return emittedEvents.shift()!;
    }

    type ForTestOpts = {
        signers?: Signer[];
        errorMsg?: string | null;
    };

    function setDefaultForTestOpts<T extends ForTestOpts>(
        opts: T,
        overrides: {
            signers?: Signer[];
        } = {},
    ): [{ signers: Signer[]; errorMsg: string | null }, Omit<T, keyof ForTestOpts>] {
        let { signers, errorMsg } = opts;
        signers ??= overrides.signers ?? [payer];
        delete opts.signers;

        errorMsg ??= null;
        delete opts.errorMsg;

        return [{ signers, errorMsg }, { ...opts }];
    }

    function newFastMarketOrder(args: {
        redeemerMessage?: Uint8Array;
        sender?: Array<number>;
        amountIn?: bigint;
        minAmountOut?: bigint;
        initAuctionFee?: bigint;
        targetChain?: Chain;
        maxFee?: bigint;
        deadline?: number;
    }): FastMarketOrder {
        const {
            amountIn,
            targetChain,
            minAmountOut,
            maxFee,
            initAuctionFee,
            deadline,
            redeemerMessage,
            sender,
        } = args;

        return {
            amountIn: amountIn ?? 1_000_000_000n,
            minAmountOut: minAmountOut ?? 0n,
            targetChain: targetChain ?? "Solana",
            redeemer: toUniversalAddress(swapLayer.custodianAddress().toBuffer()),
            sender: toUniversalAddress(sender ?? REGISTERED_PEERS["Ethereum"]!),
            refundAddress: toUniversalAddress(new Array(32).fill(3)),
            maxFee: maxFee ?? 42069n,
            initAuctionFee: initAuctionFee ?? 1_250_000n,
            deadline: deadline ?? 0,
            redeemerMessage: Buffer.from(redeemerMessage ?? Uint8Array.from([4, 20, 69])),
        };
    }

    function newSlowOrderResponse(args: { baseFee?: bigint } = {}): SlowOrderResponse {
        const { baseFee } = args;

        return {
            baseFee: baseFee ?? 420n,
        };
    }

    function preFillAmountIn(amount: bigint, relayingFee?: bigint): bigint {
        return amount + 1_250_000n + 420n + (relayingFee ?? 0n);
    }

    type VaaResult = {
        vaa: PublicKey;
        vaaAccount: VaaAccount;
    };

    type FastObservedResult = VaaResult & {
        fastMarketOrder: FastMarketOrder;
    };

    type FinalizedObservedResult = VaaResult & {
        slowOrderResponse: SlowOrderResponse;
        cctp: matchingEngineSdk.CctpMessageArgs;
    };

    type ObserveCctpOrderVaasOpts = {
        amountIn: bigint;
        baseFee?: bigint;
        initAuctionFee?: bigint;
        redeemerMessage?: Uint8Array;
        sourceChain?: Chain;
        emitter?: Array<number>;
        vaaTimestamp?: number;
        fastMarketOrder?: FastMarketOrder;
        finalized?: boolean;
        slowOrderResponse?: SlowOrderResponse;
        finalizedSourceChain?: Chain;
        finalizedEmitter?: Array<number>;
        finalizedSequence?: bigint;
        finalizedVaaTimestamp?: number;
    };

    async function observeCctpOrderVaas(opts: ObserveCctpOrderVaasOpts): Promise<{
        fast: FastObservedResult;
        finalized?: FinalizedObservedResult;
    }> {
        let {
            baseFee,
            sourceChain,
            emitter,
            vaaTimestamp,
            fastMarketOrder,
            finalized,
            slowOrderResponse,
            finalizedSourceChain,
            finalizedEmitter,
            finalizedSequence,
            finalizedVaaTimestamp,
        } = opts;
        sourceChain ??= "Ethereum";
        emitter ??= REGISTERED_TOKEN_ROUTERS[sourceChain] ?? new Array(32).fill(0);
        vaaTimestamp ??= await getBlockTime(connection);
        fastMarketOrder ??= newFastMarketOrder(opts);
        finalized ??= true;
        slowOrderResponse ??= newSlowOrderResponse({ baseFee });
        finalizedSourceChain ??= sourceChain;
        finalizedEmitter ??= emitter;
        finalizedSequence ??= finalized ? wormholeSequence++ : 0n;
        finalizedVaaTimestamp ??= vaaTimestamp;

        const sourceCctpDomain = CHAIN_TO_DOMAIN[sourceChain];
        if (sourceCctpDomain === undefined) {
            throw new Error(`Invalid source chain: ${sourceChain}`);
        }

        const fastVaa = await postLiquidityLayerVaa(
            connection,
            payer,
            MOCK_GUARDIANS,
            emitter,
            wormholeSequence++,
            new LiquidityLayerMessage({
                fastMarketOrder,
            }),
            { sourceChain, timestamp: vaaTimestamp },
        );
        const fastVaaAccount = await VaaAccount.fetch(connection, fastVaa);
        const fast = { fastMarketOrder, vaa: fastVaa, vaaAccount: fastVaaAccount };

        if (finalized) {
            const { amountIn: amount } = fastMarketOrder;
            const cctpNonce = testCctpNonce++;

            // Concoct a Circle message.
            const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                await craftCctpTokenBurnMessage(sourceCctpDomain, cctpNonce, amount);

            const finalizedMessage = new LiquidityLayerMessage({
                deposit: new LiquidityLayerDeposit({
                    tokenAddress: toUniversalAddress(burnMessage.burnTokenAddress),
                    amount,
                    sourceCctpDomain,
                    destinationCctpDomain,
                    cctpNonce,
                    burnSource: toUniversalAddress(Buffer.alloc(32, "beefdead", "hex")),
                    mintRecipient: toUniversalAddress(
                        matchingEngine.cctpMintRecipientAddress().toBuffer(),
                    ),
                    payload: { id: 2, ...slowOrderResponse },
                }),
            });

            const finalizedVaa = await postLiquidityLayerVaa(
                connection,
                payer,
                MOCK_GUARDIANS,
                finalizedEmitter,
                finalizedSequence,
                finalizedMessage,
                { sourceChain: finalizedSourceChain, timestamp: finalizedVaaTimestamp },
            );
            const finalizedVaaAccount = await VaaAccount.fetch(connection, finalizedVaa);
            return {
                fast,
                finalized: {
                    slowOrderResponse,
                    vaa: finalizedVaa,
                    vaaAccount: finalizedVaaAccount,
                    cctp: {
                        encodedCctpMessage,
                        cctpAttestation,
                    },
                },
            };
        } else {
            return { fast };
        }
    }

    async function craftCctpTokenBurnMessage(
        sourceCctpDomain: number,
        cctpNonce: bigint,
        amount: bigint,
        overrides: { destinationCctpDomain?: number } = {},
    ) {
        const { destinationCctpDomain: inputDestinationCctpDomain } = overrides;

        const messageTransmitterProgram = matchingEngine.messageTransmitterProgram();
        const { version, localDomain } =
            await messageTransmitterProgram.fetchMessageTransmitterConfig(
                messageTransmitterProgram.messageTransmitterConfigAddress(),
            );
        const destinationCctpDomain = inputDestinationCctpDomain ?? localDomain;

        const tokenMessengerMinterProgram = matchingEngine.tokenMessengerMinterProgram();
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
                targetCaller: Array.from(matchingEngine.custodianAddress().toBuffer()), // targetCaller
            },
            0,
            Array.from(tryNativeToUint8Array(ETHEREUM_USDC_ADDRESS, "Ethereum")), // sourceTokenAddress
            Array.from(matchingEngine.cctpMintRecipientAddress().toBuffer()), // mint recipient
            amount,
            new Array(32).fill(0), // burnSource
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

    async function stageOutboundForTest(
        accounts: {
            payer: PublicKey;
            senderToken: PublicKey;
            srcMint: PublicKey;
            sender?: PublicKey;
        },
        opts: {
            amountIn?: bigint;
            minAmountOut?: bigint;
            targetChain?: ChainId;
            redeemOption?:
                | { relay: { gasDropoff: number; maxRelayerFee: Uint64 } }
                | { payload: Uint8Array | Buffer }
                | null;
            outputToken?: OutputToken | null;
            transferType?: "sender" | "native";
        } = {},
    ): Promise<{
        amountIn: bigint;
        stagedOutbound: PublicKey;
        stagedCustodyToken: PublicKey;
        custodyBalance: bigint;
        stagedOutboundInfo: StagedOutboundInfo;
        redeemMode: RedeemMode;
        outputToken: OutputToken;
    }> {
        const stagedOutboundSigner = Keypair.generate();
        const stagedOutbound = stagedOutboundSigner.publicKey;

        let { amountIn, minAmountOut, targetChain, redeemOption, outputToken, transferType } = opts;
        amountIn ??= 690000n;
        minAmountOut ??= 680000n;
        targetChain ??= toChainId("Ethereum");
        redeemOption ??= null;
        outputToken ??= null;
        transferType ??= "sender";

        const accInfo = await connection.getAccountInfo(accounts.srcMint);
        if (accInfo === null) {
            throw new Error("Invalid mint account");
        }
        const srcTokenProgram = accInfo.owner;

        let sender = accounts.sender;
        if (sender === undefined) {
            if (accounts.senderToken === undefined) {
                throw new Error("Sender must be specified if senderToken is null");
            }

            const { owner } = await splToken.getAccount(
                connection,
                accounts.senderToken,
                undefined,
                srcTokenProgram,
            );
            sender = owner;
        }

        const usdcRefundToken = splToken.getAssociatedTokenAddressSync(
            swapLayer.usdcMint,
            sender,
            false,
            splToken.TOKEN_PROGRAM_ID,
        );

        const [approveIx, ix] = await swapLayer.stageOutboundIx(
            {
                ...accounts,
                stagedOutbound,
                usdcRefundToken,
            },
            {
                transferType,
                amountIn,
                isExactIn: true,
                minAmountOut,
                targetChain,
                recipient: Array.from(Buffer.alloc(32, "deadbeef")),
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
            undefined,
            srcTokenProgram,
        );

        const { info: stagedOutboundInfo } = await swapLayer.fetchStagedOutbound(stagedOutbound);

        // Fix output token if null.
        outputToken = outputToken === null ? { type: "Usdc" } : outputToken;

        const redeemMode = await (async (): Promise<RedeemMode> => {
            if (redeemOption === null) {
                return { mode: "Direct" };
            } else if ("relay" in redeemOption) {
                const { gasDropoff } = redeemOption.relay;

                const { relayParams } = await swapLayer.fetchPeer(targetChain);
                const expectedRelayerFee = calculateRelayerFee(
                    relayParams,
                    denormalizeGasDropOff(gasDropoff),
                    outputToken,
                );

                return {
                    mode: "Relay",
                    gasDropoff,
                    relayingFee: expectedRelayerFee,
                };
            } else if ("payload" in redeemOption) {
                return {
                    mode: "Payload",
                    sender: toUniversal("Solana", sender.toBytes()),
                    buf: redeemOption.payload,
                };
            } else {
                throw new Error("Invalid redeem option");
            }
        })();

        return {
            amountIn,
            stagedOutbound,
            stagedCustodyToken,
            custodyBalance,
            stagedOutboundInfo,
            redeemMode,
            outputToken,
        };
    }

    async function swapExactInForTest(
        accounts: {
            payer: PublicKey;
            stagedOutbound: PublicKey;
            stagedCustodyToken?: PublicKey;
            preparedOrder?: PublicKey;
            srcMint?: PublicKey;
            srcTokenProgram?: PublicKey;
            preparedBy?: PublicKey;
            usdcRefundToken?: PublicKey;
            srcResidual?: PublicKey;
        },
        args: {
            cpiInstruction: TransactionInstruction;
            targetChain?: ChainId;
        },
        opts: {
            additionalLuts?: PublicKey[];
        } & ForTestOpts = {},
    ) {
        const [{ signers, errorMsg }, otherOpts] = setDefaultForTestOpts(opts);

        let { additionalLuts } = otherOpts;
        additionalLuts ??= [];

        const ix = await swapLayer.initiateSwapExactInIx(accounts, args);

        const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
            units: 750_000,
        });

        const addressLookupTableAccounts = await Promise.all(
            [...luts, ...additionalLuts].map(async (lookupTableAddress) => {
                const resp = await connection.getAddressLookupTable(lookupTableAddress);
                return resp.value;
            }),
        );

        if (errorMsg !== null) {
            await expectIxErr(connection, [computeIx, ix], signers, errorMsg, {
                addressLookupTableAccounts,
            });
            return;
        }

        await expectIxOk(connection, [computeIx, ix], signers, {
            addressLookupTableAccounts,
        });
    }
});

// TODO: look into shared account swap w/ token ledger
const JUPITER_V6_TOKEN_LEDGERS = [
    new PublicKey("HtncvpUBGhSrs48KtC58ntJcTDw53sn78Lpq71zVwiez"),
    new PublicKey("HxTk98CmBcxmtkrBWqRszYxrnDpqAsbitQBc2QjVBG3j"),
    new PublicKey("CnUPHtfUVw3D2s4FB8H6QBuLwoes8YxauVgDtFybm7rz"),
    new PublicKey("FhLPkpFmszHtSyyayj7KsXNZeBTqfQbUPmvgWAyJHBXh"),
];
