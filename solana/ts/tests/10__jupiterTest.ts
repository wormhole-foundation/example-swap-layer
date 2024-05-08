import * as wormholeSdk from "@certusone/wormhole-sdk";
import * as anchor from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import {
    AccountMeta,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    Signer,
    TransactionInstruction,
} from "@solana/web3.js";
import * as legacyAnchor from "anchor-0.29.0";
import { use as chaiUse, expect } from "chai";
import { CctpTokenBurnMessage } from "../../../lib/example-liquidity-layer/solana/ts/src/cctp";
import {
    FastMarketOrder,
    LiquidityLayerDeposit,
    LiquidityLayerMessage,
    SlowOrderResponse,
} from "../../../lib/example-liquidity-layer/solana/ts/src/common";
import * as matchingEngineSdk from "../../../lib/example-liquidity-layer/solana/ts/src/matchingEngine";
import { VaaAccount } from "../../../lib/example-liquidity-layer/solana/ts/src/wormhole";
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
    expectIxOk,
    getBlockTime,
    postLiquidityLayerVaa,
} from "../../../lib/example-liquidity-layer/solana/ts/tests/helpers";
import SWAP_LAYER_IDL from "../../target/idl/swap_layer.json";
import * as jupiter from "../src/jupiter";
import { SwapLayerProgram, localnet } from "../src/swapLayer";
import { IDL as WHIRLPOOL_IDL, Whirlpool } from "../src/types/whirlpool";
import { FEE_UPDATER_KEYPAIR, createLut } from "./helpers";

chaiUse(require("chai-as-promised"));

const SWAP_LAYER_PROGRAM_ID = new PublicKey("AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m");

const USDT_MINT_ADDRESS = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const USDC_MINT_ADDRESS = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const JUPITER_V6_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

const WHIRLPOOL_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const WHIRLPOOL_USDC_USDT = new PublicKey("4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4");

describe("Jupiter V6 Testing", () => {
    const connection = new Connection(LOCALHOST, "processed");
    const payer = PAYER_KEYPAIR;
    const relayer = Keypair.generate();
    const owner = OWNER_KEYPAIR;
    const recipient = Keypair.generate();
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
    const tokenRouter = swapLayer.tokenRouterProgram();
    const matchingEngine = tokenRouter.matchingEngineProgram();

    const whirlpoolProgram = new legacyAnchor.Program(WHIRLPOOL_IDL, WHIRLPOOL_PROGRAM_ID, {
        connection,
    });

    const swapLayerProgram = new anchor.Program(
        { ...(SWAP_LAYER_IDL as any), address: SWAP_LAYER_PROGRAM_ID.toString() },
        {
            connection,
        },
    );

    const luts: [PublicKey, PublicKey] = [PublicKey.default, PublicKey.default];

    let testCctpNonce = 2n ** 64n - 1n;

    // Hack to prevent math overflow error when invoking CCTP programs.
    testCctpNonce -= 100n * 6400n;

    let wormholeSequence = 10000n;

    describe("Setup", function () {
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

        it("Placeholder", async function () {
            // TODO
        });
    });

    describe("Whirlpool", function () {
        it.skip("Swap USDT to USDC", async function () {
            const swapIx = jupiter.toTransactionInstruction(
                jupiterV6SwapIxResponseWhirlpool.swapInstruction,
            );

            const usdtToken = splToken.getAssociatedTokenAddressSync(
                USDT_MINT_ADDRESS,
                payer.publicKey,
            );
            const usdtTokenData = await splToken.getAccount(connection, usdtToken);
            console.log({ usdtTokenData });

            const usdcToken = splToken.getAssociatedTokenAddressSync(
                USDC_MINT_ADDRESS,
                payer.publicKey,
            );
            const usdcTokenData = await splToken.getAccount(connection, usdcToken);
            console.log({ usdcTokenData });

            const transferAuthority = jupiterTransferAuthorityAddress(2);
            const ix = jupiterV6SwapIx(
                {
                    user: payer.publicKey,
                    transferAuthority,
                    inputMint: USDT_MINT_ADDRESS,
                    outputMint: USDC_MINT_ADDRESS,
                },
                //swapIx.keys.slice(13),
                await whirlpoolIxSetup(
                    whirlpoolProgram,
                    { tokenAuthority: transferAuthority, whirlpool: WHIRLPOOL_USDC_USDT },
                    true,
                ),
                swapIx.data,
            );

            expect(swapIx.keys).has.length(ix.keys.length);

            const txSig = await expectIxOk(connection, [ix], [payer]);
        });
    });

    describe("Complete Swap Passthrough (WIP)", function () {
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

        // afterEach("Clear Emitted Events", function () {
        //     while (emittedEvents.length > 0) {
        //         emittedEvents.pop();
        //     }
        // });

        it("Generate Fast Fill", async function () {
            const { fastFill, preparedFill } = await redeemFastFillForTest(
                { payer: payer.publicKey },
                emittedEvents,
            );
        });

        it.skip("Swap USDT to USDC", async function () {
            const ixData = Buffer.from(
                "wSCbM0HWnIECAQAAABEAZAABAHQ7pAsAAAAoYEulCwAAADIAAA==",
                "base64",
            );
            const transferAuthority = jupiterTransferAuthorityAddress(2);
            const innerIx = jupiterV6SwapIx(
                {
                    user: payer.publicKey,
                    transferAuthority,
                    inputMint: USDT_MINT_ADDRESS,
                    outputMint: USDC_MINT_ADDRESS,
                },
                //swapIx.keys.slice(13),
                await whirlpoolIxSetup(
                    whirlpoolProgram,
                    { tokenAuthority: transferAuthority, whirlpool: WHIRLPOOL_USDC_USDT },
                    true,
                ),
                ixData,
            );

            // const ix = await swapLayerProgram.methods
            //     .completeSwap(ixData)
            //     .accounts({
            //         srcToken: splToken.getAssociatedTokenAddressSync(
            //             USDT_MINT_ADDRESS,
            //             payer.publicKey,
            //         ),
            //     })
            //     .remainingAccounts(innerIx.keys)
            //     .instruction();

            // const txSig = await expectIxOk(connection, [ix], [payer]);
        });
    });

    type PrepareOrderResponseForTestOptionalOpts = {
        args?: matchingEngineSdk.CctpMessageArgs;
    };

    async function prepareOrderResponseCctpForTest(
        accounts: {
            payer: PublicKey;
        },
        opts: ObserveCctpOrderVaasOpts & PrepareOrderResponseForTestOptionalOpts = {},
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

    async function reserveFastFillSequenceNoAuctionForTest(accounts: {
        payer: PublicKey;
        fastVaa?: PublicKey;
        auction?: PublicKey;
        preparedOrderResponse?: PublicKey;
    }): Promise<
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
                const result = await prepareOrderResponseCctpForTest({
                    payer: accounts.payer,
                });
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
    ): Promise<undefined | { event: matchingEngineSdk.LocalFastOrderFilled }> {
        const reserveResult = await reserveFastFillSequenceNoAuctionForTest({
            payer: accounts.payer,
        });

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

    async function redeemFastFillForTest(
        accounts: { payer: PublicKey },
        emittedEvents: EmittedFilledLocalFastOrder[],
    ) {
        const settleResult = await settleAuctionNoneLocalForTest(
            { payer: payer.publicKey },
            emittedEvents,
        );
        const {
            event: {
                seeds: { sourceChain, orderSender, sequence },
            },
        } = settleResult!;

        const fastFill = matchingEngine.fastFillAddress(
            sourceChain as wormholeSdk.ChainId,
            orderSender,
            sequence,
        );

        const ix = await tokenRouter.redeemFastFillIx({
            ...accounts,
            fastFill,
        });

        await expectIxOk(connection, [ix], [payer]);

        return { fastFill, preparedFill: tokenRouter.preparedFillAddress(fastFill) };
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

    function newFastMarketOrder(
        args: {
            amountIn?: bigint;
            minAmountOut?: bigint;
            initAuctionFee?: bigint;
            targetChain?: wormholeSdk.ChainName;
            maxFee?: bigint;
            deadline?: number;
            redeemerMessage?: Buffer;
        } = {},
    ): FastMarketOrder {
        const {
            amountIn,
            targetChain,
            minAmountOut,
            maxFee,
            initAuctionFee,
            deadline,
            redeemerMessage,
        } = args;

        return {
            amountIn: amountIn ?? 1_000_000_000n,
            minAmountOut: minAmountOut ?? 0n,
            targetChain: wormholeSdk.coalesceChainId(targetChain ?? "solana"),
            redeemer: Array.from(swapLayer.custodianAddress().toBuffer()),
            sender: new Array(32).fill(2),
            refundAddress: new Array(32).fill(3),
            maxFee: maxFee ?? 42069n,
            initAuctionFee: initAuctionFee ?? 1_250_000n,
            deadline: deadline ?? 0,
            redeemerMessage: redeemerMessage ?? Buffer.from("Somebody set up us the bomb"),
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
        sourceChain?: wormholeSdk.ChainName;
        emitter?: Array<number>;
        vaaTimestamp?: number;
        fastMarketOrder?: FastMarketOrder;
        finalized?: boolean;
        slowOrderResponse?: SlowOrderResponse;
        finalizedSourceChain?: wormholeSdk.ChainName;
        finalizedEmitter?: Array<number>;
        finalizedSequence?: bigint;
        finalizedVaaTimestamp?: number;
    };

    async function observeCctpOrderVaas(opts: ObserveCctpOrderVaasOpts = {}): Promise<{
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
        sourceChain ??= "ethereum";
        emitter ??= REGISTERED_TOKEN_ROUTERS[sourceChain] ?? new Array(32).fill(0);
        vaaTimestamp ??= await getBlockTime(connection);
        fastMarketOrder ??= newFastMarketOrder();
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
            Array.from(wormholeSdk.tryNativeToUint8Array(ETHEREUM_USDC_ADDRESS, "ethereum")), // sourceTokenAddress
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

const jupiterV6SwapIxResponseWhirlpool = {
    computeBudgetInstructions: [
        {
            programId: "ComputeBudget111111111111111111111111111111",
            accounts: [],
            data: "AsBcFQA=",
        },
        {
            programId: "ComputeBudget111111111111111111111111111111",
            accounts: [],
            data: "AwQXAQAAAAAA",
        },
    ],
    setupInstructions: [
        {
            programId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
            accounts: [
                {
                    pubkey: "21TrZtZnFU1rEvmiKTNSdZz7voe8kRZL7KX3pEGe7rS2",
                    isSigner: true,
                    isWritable: true,
                },
                {
                    pubkey: "CyBqVej3Bq73UGdaYv2BMNLeRhfv2nkUSy2KA4Tc5WtE",
                    isSigner: false,
                    isWritable: true,
                },
                {
                    pubkey: "21TrZtZnFU1rEvmiKTNSdZz7voe8kRZL7KX3pEGe7rS2",
                    isSigner: false,
                    isWritable: false,
                },
                {
                    pubkey: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                    isSigner: false,
                    isWritable: false,
                },
                {
                    pubkey: "11111111111111111111111111111111",
                    isSigner: false,
                    isWritable: false,
                },
                {
                    pubkey: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                    isSigner: false,
                    isWritable: false,
                },
            ],
            data: "AQ==",
        },
    ],
    swapInstruction: {
        programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
        accounts: [
            {
                pubkey: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV",
                isSigner: false,
                isWritable: false,
            },
            {
                //pubkey: "21TrZtZnFU1rEvmiKTNSdZz7voe8kRZL7KX3pEGe7rS2",
                pubkey: "pFCBP4bhqdSsrWUVTgqhPsLrfEdChBK17vgFM7TxjxQ",
                isSigner: true,
                isWritable: false,
            },
            {
                //pubkey: "BGNHoqiqB4oM7caZvDUKqC2JMfjXA8MnxeeaGrHdJ5xP",
                pubkey: "4MXG73DEVVRN9xiJavCkFVFtZdYBrKmD1hjxmTtNoZnA",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "6pXVFSACE5BND2C3ibGRWMG1fNtV7hfynWrfNKtCXhN3",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "7u7cD7NxcZEuzRCBaYo8uVpotRdqZwez47vvuwzCov43",
                isSigner: false,
                isWritable: true,
            },
            {
                //pubkey: "CyBqVej3Bq73UGdaYv2BMNLeRhfv2nkUSy2KA4Tc5WtE",
                pubkey: "4tKtuvtQ4TzkkrkESnRpbfSXCEZPkZe3eL5tCFUdpxtf",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "7u7cD7NxcZEuzRCBaYo8uVpotRdqZwez47vvuwzCov43",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "4oY1eVHJrt7ywuFoQnAZwto4qcQip1QhYMAhD11PU4QL",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "6pXVFSACE5BND2C3ibGRWMG1fNtV7hfynWrfNKtCXhN3",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "4dSG9tKHZR4CAictyEnH9XuGZyKapodWXq5xyg7uFwE9",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "8kZSTVuV7C4GD9ZVR4wDtRSXv1SvsSQPfqUbthueRNGV",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "FqFkv2xNNCUyx1RYV61pGZ9AMzGfgcD8uXC9zCF5JKnR",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "A7sdy3NoAZp49cQNpreMGARAb9QJjYrrSyDALhThgk3D",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "3NxDBWt55DZnEwwQ2bhQ3xWG8Jd18TdUXAG4Zdr7jDai",
                isSigner: false,
                isWritable: false,
            },
        ],
        data: "wSCbM0HWnIECAQAAABEAZAABAHQ7pAsAAAAoYEulCwAAADIAAA==",
    },
    addressLookupTableAddresses: ["GxS6FiQ3mNnAar9HGQ6mxP7t6FcwmHkU7peSeQDUHmpN"],
};

function eventAuthorityAddress(programId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], programId)[0];
}

function jupiterTransferAuthorityAddress(authorityId: number) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("authority"), Buffer.from([authorityId])],
        JUPITER_V6_PROGRAM_ID,
    )[0];
}

async function whirlpoolIxSetup(
    whirlpoolProgram: legacyAnchor.Program<Whirlpool>,
    accounts: { tokenAuthority: PublicKey; whirlpool: PublicKey },
    aToB: boolean,
): Promise<AccountMeta[]> {
    const { tokenAuthority, whirlpool } = accounts;

    const { tokenMintA, tokenMintB, tokenVaultA, tokenVaultB } =
        await whirlpoolProgram.account.whirlpool.fetch(whirlpool);

    const { tickArray0, tickArray1, tickArray2 } = (() => {
        if (whirlpool.equals(WHIRLPOOL_USDC_USDT)) {
            const tickArray0 = new PublicKey("8kZSTVuV7C4GD9ZVR4wDtRSXv1SvsSQPfqUbthueRNGV");
            if (aToB) {
                return {
                    tickArray0,
                    tickArray1: new PublicKey("FqFkv2xNNCUyx1RYV61pGZ9AMzGfgcD8uXC9zCF5JKnR"),
                    tickArray2: new PublicKey("A7sdy3NoAZp49cQNpreMGARAb9QJjYrrSyDALhThgk3D"),
                };
            } else {
                return {
                    tickArray0,
                    tickArray1: new PublicKey("2B48L1ACPvVb67UKeSMkUGdzrnhvNMm6pFt2nspGKxs4"),
                    tickArray2: new PublicKey("BMGfBaW69aUm6hRdmsfAcNEmAW59C2rWJ9EX7gWnrVN9"),
                };
            }
        } else {
            throw new Error("Unrecognized whirlpool");
        }
    })();
    const swapAccounts = [
        {
            pubkey: splToken.TOKEN_PROGRAM_ID,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: tokenAuthority,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: whirlpool,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: splToken.getAssociatedTokenAddressSync(
                tokenMintA,
                tokenAuthority,
                true, // allowOwnerOffCurve
            ),
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: tokenVaultA,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: splToken.getAssociatedTokenAddressSync(
                tokenMintB,
                tokenAuthority,
                true, // allowOwnerOffCurve
            ),
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: tokenVaultB,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: tickArray0,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: tickArray1,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: tickArray2,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: PublicKey.findProgramAddressSync(
                [Buffer.from("oracle"), whirlpool.toBuffer()],
                whirlpoolProgram.programId,
            )[0],
            isWritable: false,
            isSigner: false,
        },
    ];

    return [{ pubkey: WHIRLPOOL_PROGRAM_ID, isWritable: false, isSigner: false }].concat(
        swapAccounts,
    );
}

function jupiterV6SwapIx(
    accounts: {
        user: PublicKey;
        transferAuthority: PublicKey;
        inputMint: PublicKey;
        outputMint: PublicKey;
        platformFee?: PublicKey;
    },
    composedDexAccountMetas: AccountMeta[],
    ixData: Buffer,
): TransactionInstruction {
    const { user, transferAuthority, inputMint, outputMint } = accounts;

    let { platformFee } = accounts;

    platformFee ??= JUPITER_V6_PROGRAM_ID;
    const platformFeeIsWritable = platformFee.equals(JUPITER_V6_PROGRAM_ID);

    const token2022Program = JUPITER_V6_PROGRAM_ID; // disables this option

    const sourceToken = splToken.getAssociatedTokenAddressSync(
        inputMint,
        user,
        //true, // allowOwnerOffCurve
    );
    const destinationToken = splToken.getAssociatedTokenAddressSync(
        outputMint,
        user,
        true, // allowOwnerOffCurve
    );

    const programSourceToken = splToken.getAssociatedTokenAddressSync(
        inputMint,
        transferAuthority,
        true, // allowOwnerOffCurve
    );
    const programDestinationToken = splToken.getAssociatedTokenAddressSync(
        outputMint,
        transferAuthority,
        true, // allowOwnerOffCurve
    );

    const eventAuthority = eventAuthorityAddress(JUPITER_V6_PROGRAM_ID);

    const jupiterV6Keys = [
        { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: transferAuthority, isSigner: false, isWritable: false },
        { pubkey: user, isSigner: true, isWritable: false },
        { pubkey: sourceToken, isSigner: false, isWritable: true },
        { pubkey: programSourceToken, isSigner: false, isWritable: true },
        { pubkey: programDestinationToken, isSigner: false, isWritable: true },
        { pubkey: destinationToken, isSigner: false, isWritable: true },
        { pubkey: inputMint, isSigner: false, isWritable: false },
        { pubkey: outputMint, isSigner: false, isWritable: false },
        { pubkey: platformFee, isSigner: false, isWritable: platformFeeIsWritable },
        { pubkey: token2022Program, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: JUPITER_V6_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    return {
        programId: JUPITER_V6_PROGRAM_ID,
        keys: jupiterV6Keys.concat(composedDexAccountMetas),
        data: ixData,
    };
}

// TODO: look into shared account swap w/ token ledger
const JUPITER_V6_TOKEN_LEDGERS = [
    new PublicKey("HtncvpUBGhSrs48KtC58ntJcTDw53sn78Lpq71zVwiez"),
    new PublicKey("HxTk98CmBcxmtkrBWqRszYxrnDpqAsbitQBc2QjVBG3j"),
    new PublicKey("CnUPHtfUVw3D2s4FB8H6QBuLwoes8YxauVgDtFybm7rz"),
    new PublicKey("FhLPkpFmszHtSyyayj7KsXNZeBTqfQbUPmvgWAyJHBXh"),
];
