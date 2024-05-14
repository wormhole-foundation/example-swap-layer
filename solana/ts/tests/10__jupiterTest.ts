import * as splToken from "@solana/spl-token";
import {
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    Signer,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import { CctpTokenBurnMessage } from "@wormhole-foundation/example-liquidity-layer-solana/cctp";
import {
    FastMarketOrder,
    LiquidityLayerDeposit,
    LiquidityLayerMessage,
    SlowOrderResponse,
} from "@wormhole-foundation/example-liquidity-layer-solana/common";
import * as matchingEngineSdk from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import {
    CHAIN_TO_DOMAIN,
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
    getBlockTime,
    postLiquidityLayerVaa,
} from "@wormhole-foundation/example-liquidity-layer-solana/testing";
import { VaaAccount } from "@wormhole-foundation/example-liquidity-layer-solana/wormhole";
import { Chain, toChainId } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";
import { assert } from "chai";
import * as fs from "fs";
import * as jupiterV6 from "../src/jupiterV6";
import {
    OutputToken,
    RedeemMode,
    SwapLayerMessage,
    SwapLayerProgram,
    decodeSwapLayerMessage,
    encodeSwapLayerMessage,
    localnet,
} from "../src/swapLayer";
import {
    FEE_UPDATER_KEYPAIR,
    REGISTERED_PEERS,
    USDT_MINT_ADDRESS,
    createLut,
    tryNativeToUint8Array,
} from "./helpers";

describe("Jupiter V6 Testing", () => {
    const connection = new Connection(LOCALHOST, "processed");

    const payer = PAYER_KEYPAIR;
    const relayer = Keypair.generate();
    const owner = OWNER_KEYPAIR;
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;
    const feeUpdater = FEE_UPDATER_KEYPAIR;

    // Program SDKs
    const swapLayer = new SwapLayerProgram(connection, localnet(), USDC_MINT_ADDRESS);
    const tokenRouter = swapLayer.tokenRouterProgram();
    const matchingEngine = tokenRouter.matchingEngineProgram();

    const luts: [PublicKey, PublicKey] = [PublicKey.default, PublicKey.default];

    let testCctpNonce = 2n ** 64n - 1n;

    // Hack to prevent math overflow error when invoking CCTP programs.
    testCctpNonce -= 100n * 6400n;

    let wormholeSequence = 10000n;

    describe("Jupiter V6 Setup", function () {
        before("Generate ATAs", async function () {
            for (const mint of [swapLayer.mint, USDT_MINT_ADDRESS, splToken.NATIVE_MINT]) {
                for (let i = 0; i < 8; ++i) {
                    const authority = jupiterV6.programAuthorityAddress(i);

                    await splToken.getOrCreateAssociatedTokenAccount(
                        connection,
                        payer,
                        mint,
                        authority,
                        true, // allowOwnerOffCurve
                    );
                }
            }

            const payerWsol = splToken.getAssociatedTokenAddressSync(
                splToken.NATIVE_MINT,
                payer.publicKey,
            );

            await expectIxOk(
                connection,
                [
                    splToken.createAssociatedTokenAccountInstruction(
                        payer.publicKey,
                        payerWsol,
                        payer.publicKey,
                        splToken.NATIVE_MINT,
                    ),
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: payerWsol,
                        lamports: 2_000_000_000_000n,
                    }),
                    splToken.createSyncNativeInstruction(payerWsol),
                ],
                [payer],
            );
        });

        after("Setup Lookup Tables", async function () {
            luts[0] = await createLut(
                connection,
                payer,
                await tokenRouter
                    .commonAccounts()
                    .then((accounts) => Object.values(accounts).filter((key) => key !== undefined)),
            );

            luts[1] = await createLut(
                connection,
                payer,
                await matchingEngine
                    .commonAccounts()
                    .then((accounts) => Object.values(accounts).filter((key) => key !== undefined)),
            );
        });

        it("User Swap USDC to USDT From Simulated Quote -- Whirlpool", async function () {
            await invokeSharedAccountsRouteAsUser(
                modifyUsdcToUsdtSwapResponseForTest(payer.publicKey, {
                    inAmount: 100_000_000n,
                    quotedOutAmount: 100_000_000n,
                    slippageBps: 50,
                }),
            );
        });

        it("User Swap USDT to USDC From Simulated Quote -- Whirlpool", async function () {
            await invokeSharedAccountsRouteAsUser(
                modifyUsdtToUsdcSwapResponseForTest(payer.publicKey, {
                    inAmount: 50_000_000n,
                    quotedOutAmount: 50_000_000n,
                    slippageBps: 50,
                }),
            );
        });

        it("User Swap USDC to WSOL From Simulated Quote -- Phoenix V1", async function () {
            await invokeSharedAccountsRouteAsUser(
                modifyUsdcToWsolSwapResponseForTest(payer.publicKey, {
                    inAmount: 150_000_000n,
                    quotedOutAmount: 1_000_000_000n,
                    slippageBps: 200,
                }),
            );
        });

        it("User Swap WSOL to USDC From Simulated Quote -- Phoenix V1", async function () {
            await invokeSharedAccountsRouteAsUser(
                modifyWsolToUsdcSwapResponseForTest(payer.publicKey, {
                    inAmount: 1_000_000_000n,
                    quotedOutAmount: 150_000_000n,
                    slippageBps: 200,
                }),
            );
        });

        async function invokeSharedAccountsRouteAsUser(
            modifyArgs: jupiterV6.ModifiedSharedAccountsRoute,
        ) {
            const {
                instruction: ix,
                sourceToken: srcToken,
                destinationToken: dstToken,
                minAmountOut,
            } = modifyArgs;

            const { amount: srcBalanceBefore } = await splToken.getAccount(connection, srcToken);
            const { amount: dstBalanceBefore } = await splToken.getAccount(connection, dstToken);

            await expectIxOk(connection, [ix], [payer]);

            const decodedIxData = jupiterV6.decodeSharedAccountsRouteArgs(ix.data);

            const { amount: srcBalanceAfter } = await splToken.getAccount(connection, srcToken);
            assert.strictEqual(srcBalanceBefore - srcBalanceAfter, decodedIxData.inAmount);

            const { amount: dstBalanceAfter } = await splToken.getAccount(connection, dstToken);
            assert.isTrue(dstBalanceAfter - dstBalanceBefore >= minAmountOut);
        }
    });

    describe("Complete Swap -- Direct", function () {
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

        it("Other -- USDT via Whirlpool", async function () {
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

        it("Other -- WSOL via Phoenix V1", async function () {
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
    });

    async function completeSwapDirectForTest(
        accounts: {
            payer: PublicKey;
            preparedFill: PublicKey;
            recipient: PublicKey;
            dstMint?: PublicKey;
        },
        opts: ForTestOpts & {
            limitAmount: bigint;
            swapResponseModifier: (
                tokenOwner: PublicKey,
                opts: jupiterV6.ModifySharedAccountsRouteOpts,
            ) => jupiterV6.ModifiedSharedAccountsRoute;
        },
    ): Promise<undefined> {
        const [{ signers, errorMsg }, otherOpts] = setDefaultForTestOpts(opts);
        const { limitAmount, swapResponseModifier } = otherOpts;

        const { instruction: cpiInstruction, destinationMint } = swapResponseModifier(
            swapLayer.swapAuthorityAddress(accounts.preparedFill),
            {
                cpi: true,
            },
        );
        const expectedDstMint = accounts.dstMint ?? splToken.NATIVE_MINT;
        assert.deepEqual(destinationMint, expectedDstMint);

        const ix = await swapLayer.completeSwapDirectIx(accounts, { cpiInstruction });

        const ixs = [
            ComputeBudgetProgram.setComputeUnitLimit({
                units: 420_000,
            }),
            ix,
        ];

        const addressLookupTableAccounts = await Promise.all(
            luts.map(async (lookupTableAddress) => {
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

        if (outputToken.type === "Gas") {
            const balanceBefore = await connection.getBalance(accounts.recipient).then(BigInt);

            await expectIxOk(connection, ixs, signers, {
                addressLookupTableAccounts,
            });

            const balanceAfter = await connection.getBalance(accounts.recipient).then(BigInt);
            assert.isTrue(balanceAfter - balanceBefore >= limitAmount);
        } else if (outputToken.type === "Other") {
            const dstToken = splToken.getAssociatedTokenAddressSync(
                expectedDstMint,
                accounts.recipient,
            );
            const { amount: dstBalanceBefore } = await splToken.getAccount(connection, dstToken);

            await expectIxOk(connection, ixs, signers, {
                addressLookupTableAccounts,
            });

            const { amount: dstBalanceAfter } = await splToken.getAccount(connection, dstToken);
            assert.isTrue(dstBalanceAfter - dstBalanceBefore >= limitAmount);
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
        },
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
        const recipientToken = splToken.getAssociatedTokenAddressSync(dstMint, recipient);

        await expectIxOk(
            connection,
            [
                splToken.createAssociatedTokenAccountInstruction(
                    payer.publicKey,
                    recipientToken,
                    recipient,
                    dstMint,
                ),
            ],
            [payer],
        );

        const msg = {
            recipient: toUniversal("Solana", recipient.toString()),
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

    function modifyUsdcToUsdtSwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): jupiterV6.ModifiedSharedAccountsRoute {
        const response = JSON.parse(
            fs.readFileSync(`${__dirname}/jupiterV6SwapResponses/whirlpool_usdc_to_usdt.json`, {
                encoding: "utf-8",
            }),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(response, tokenOwner, opts);
    }

    function modifyUsdtToUsdcSwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): jupiterV6.ModifiedSharedAccountsRoute {
        const response = JSON.parse(
            fs.readFileSync(`${__dirname}/jupiterV6SwapResponses/whirlpool_usdt_to_usdc.json`, {
                encoding: "utf-8",
            }),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(response, tokenOwner, opts);
    }

    function modifyUsdcToWsolSwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): jupiterV6.ModifiedSharedAccountsRoute {
        const response = JSON.parse(
            fs.readFileSync(`${__dirname}/jupiterV6SwapResponses/phoenix_v1_usdc_to_wsol.json`, {
                encoding: "utf-8",
            }),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(response, tokenOwner, opts);
    }

    function modifyWsolToUsdcSwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): jupiterV6.ModifiedSharedAccountsRoute {
        const response = JSON.parse(
            fs.readFileSync(`${__dirname}/jupiterV6SwapResponses/phoenix_v1_wsol_to_usdc.json`, {
                encoding: "utf-8",
            }),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(response, tokenOwner, opts);
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
            console.log("waiting...");
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
            targetChain: toChainId(targetChain ?? "Solana"),
            redeemer: Array.from(swapLayer.custodianAddress().toBuffer()),
            sender: sender ?? REGISTERED_PEERS["Ethereum"]!,
            refundAddress: new Array(32).fill(3),
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
        slowOrderResponse ??= newSlowOrderResponse();
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
                deposit: new LiquidityLayerDeposit(
                    {
                        tokenAddress: burnMessage.burnTokenAddress,
                        amount,
                        sourceCctpDomain,
                        destinationCctpDomain,
                        cctpNonce,
                        burnSource: Array.from(Buffer.alloc(32, "beefdead", "hex")),
                        mintRecipient: Array.from(
                            matchingEngine.cctpMintRecipientAddress().toBuffer(),
                        ),
                    },
                    {
                        slowOrderResponse,
                    },
                ),
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
});

// TODO: look into shared account swap w/ token ledger
const JUPITER_V6_TOKEN_LEDGERS = [
    new PublicKey("HtncvpUBGhSrs48KtC58ntJcTDw53sn78Lpq71zVwiez"),
    new PublicKey("HxTk98CmBcxmtkrBWqRszYxrnDpqAsbitQBc2QjVBG3j"),
    new PublicKey("CnUPHtfUVw3D2s4FB8H6QBuLwoes8YxauVgDtFybm7rz"),
    new PublicKey("FhLPkpFmszHtSyyayj7KsXNZeBTqfQbUPmvgWAyJHBXh"),
];
