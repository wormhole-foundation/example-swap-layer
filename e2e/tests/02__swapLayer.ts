import { BN } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
    CircleAttester,
    LOCALHOST,
    OWNER_KEYPAIR,
    PAYER_KEYPAIR,
    expectIxOk,
    getUsdcAtaBalance,
} from "@wormhole-foundation/example-liquidity-layer-solana/testing";
import { Chain, toChainId } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";
import { assert } from "chai";
import { ethers } from "ethers";
import * as fs from "fs";
import {
    ATTESTATION_TYPE_LL,
    EVM_CONFIG,
    EVM_FEE_RECIPIENT,
    GUARDIAN_SET_INDEX,
    GuardianNetwork,
    ONE_ETHER,
    ONE_SOL,
    SOLANA_SWAP_LAYER_ID,
    USDC_MINT_ADDRESS,
    USDT_ETH,
    completeSwapForTest,
    evmSwapLayerConfig,
    getUsdtAtaBalance,
    getUsdtBalanceEthereum,
    initiateOnEvmSwapLayer,
    initiateOnSolanaSwapLayer,
    postSignedVaa,
    redeemFillOnSolana,
    usdcContract,
    usdtContract,
} from "./helpers";

import { InitiateArgs, encodeInitiateArgs, encodeQueriesBatch } from "../../evm/ts-sdk/lib/cjs";
import * as jupiterV6 from "../../solana/ts/src/jupiterV6";
import * as swapLayerSdk from "../../solana/ts/src/swapLayer";
import { USDT_MINT_ADDRESS, createAta, createLut } from "../../solana/ts/tests/helpers";

const EVM_CHAIN_PATHWAYS: [Chain, Chain][] = [
    ["Ethereum", "Base"],
    ["Base", "Ethereum"],
];

describe("Swap Layer", () => {
    // Solana.
    const solanaPayer = PAYER_KEYPAIR;
    const solanaRelayer = Keypair.generate();
    const solanaRecipient = Keypair.generate();
    const solanaFeeRecipient = OWNER_KEYPAIR;
    const connection = new Connection(LOCALHOST, "confirmed");
    const solanaSwapLayer = new swapLayerSdk.SwapLayerProgram(
        connection,
        SOLANA_SWAP_LAYER_ID,
        USDC_MINT_ADDRESS,
    );
    const solanaTokenRouter = solanaSwapLayer.tokenRouterProgram();
    let tokenRouterLkupTable: PublicKey;

    let localVariables = {};

    for (const [fromChain, toChain] of EVM_CHAIN_PATHWAYS) {
        // From contracts.
        const from = evmSwapLayerConfig(fromChain);
        const fromConfig = EVM_CONFIG[fromChain];
        const fromUsdc = usdcContract(fromChain);

        // To contracts.
        const to = evmSwapLayerConfig(toChain);
        const toUsdc = usdcContract(toChain);

        before("Approve Max", async function () {
            await fromUsdc.contract
                .connect(from.wallet)
                .approve(from.contract.address, ethers.constants.MaxUint256)
                .then((tx) => tx.wait());
        });

        describe(`${fromChain} <> ${toChain}`, function () {
            describe("Usdc", function () {
                describe("Direct", function () {
                    it("Outbound", async function () {
                        const amountIn = 20_000_000_000; // 20k USDC

                        const output: InitiateArgs = {
                            transferMode: {
                                mode: "LiquidityLayer",
                            },
                            redeemMode: {
                                mode: "Direct",
                            },
                            outputToken: {
                                type: "Usdc",
                            },
                            isExactIn: true,
                            inputToken: {
                                type: "Usdc",
                                amount: BigInt(amountIn),
                                acquireMode: {
                                    mode: "Preapproved",
                                },
                            },
                        };

                        const balanceBefore = await fromUsdc.contract.balanceOf(
                            from.wallet.address,
                        );

                        const { orderResponse } = await initiateOnEvmSwapLayer(
                            encodeInitiateArgs(output),
                            toUniversal(fromChain, to.wallet.address),
                            fromChain,
                            toChain,
                            from.contract,
                        );

                        const balanceAfter = await fromUsdc.contract.balanceOf(from.wallet.address);
                        assert.equal(balanceBefore.sub(balanceAfter).toNumber(), amountIn);

                        localVariables["orderResponse"] = orderResponse;
                        localVariables["amountIn"] = amountIn;
                    });

                    it("Inbound", async function () {
                        const balanceBefore = await toUsdc.contract.balanceOf(to.wallet.address);
                        const etherBefore = await to.provider.getBalance(to.wallet.address);

                        // Perform the direct redeem.
                        const receipt = await to.contract
                            .redeem([], localVariables["orderResponse"])
                            .then((tx) => tx.wait());

                        const balanceAfter = await toUsdc.contract.balanceOf(to.wallet.address);
                        const etherAfter = await to.provider.getBalance(to.wallet.address);

                        assert.isTrue(
                            etherBefore
                                .sub(etherAfter)
                                .eq(receipt.effectiveGasPrice.mul(receipt.gasUsed)),
                        );
                        assert.equal(
                            balanceAfter.sub(balanceBefore).toNumber(),
                            localVariables["amountIn"],
                        );

                        localVariables = {};
                    });
                });

                describe("Relay", function () {
                    it("Outbound", async function () {
                        const amountIn = 20_000_000_000; // 20k USDC
                        const gasDropoff = BigInt(ONE_ETHER);

                        let relayingFee = await from.contract
                            .batchQueries(
                                encodeQueriesBatch([
                                    {
                                        query: "RelayingFee",
                                        chain: toChain,
                                        gasDropoff,
                                        outputToken: { type: "Usdc" },
                                    },
                                ]),
                            )
                            .then((encodedFee) => Number(encodedFee));

                        const output: InitiateArgs = {
                            transferMode: {
                                mode: "LiquidityLayer",
                            },
                            redeemMode: {
                                mode: "Relay",
                                gasDropoff,
                                maxRelayingFee: relayingFee,
                            },
                            outputToken: {
                                type: "Usdc",
                            },
                            isExactIn: false,
                            inputToken: {
                                type: "Usdc",
                                amount: BigInt(amountIn),
                                acquireMode: {
                                    mode: "Preapproved",
                                },
                            },
                        };

                        const balanceBefore = await fromUsdc.contract.balanceOf(
                            from.wallet.address,
                        );

                        const { orderResponse } = await initiateOnEvmSwapLayer(
                            encodeInitiateArgs(output),
                            toUniversal(fromChain, to.wallet.address),
                            fromChain,
                            toChain,
                            from.contract,
                        );

                        const balanceAfter = await fromUsdc.contract.balanceOf(from.wallet.address);
                        assert.equal(
                            balanceBefore.sub(balanceAfter).toNumber(),
                            amountIn + relayingFee,
                        );

                        localVariables["orderResponse"] = orderResponse;
                        localVariables["amountIn"] = amountIn;
                        localVariables["relayingFee"] = relayingFee;
                        localVariables["gasDropoff"] = gasDropoff;
                    });

                    it("Inbound", async function () {
                        const balanceBefore = await toUsdc.contract.balanceOf(to.wallet.address);
                        const etherBefore = await to.provider.getBalance(to.wallet.address);
                        const relayerBefore = await toUsdc.contract.balanceOf(to.relayer.address);
                        const feeRecipientBefore =
                            await toUsdc.contract.balanceOf(EVM_FEE_RECIPIENT);

                        // Perform the relay from the relayer wallet.
                        const receipt = await to.contract
                            .connect(to.relayer)
                            .redeem([], localVariables["orderResponse"], {
                                value: localVariables["gasDropoff"],
                            })
                            .then((tx) => tx.wait());

                        const balanceAfter = await toUsdc.contract.balanceOf(to.wallet.address);
                        const etherAfter = await to.provider.getBalance(to.wallet.address);
                        const relayerAfter = await toUsdc.contract.balanceOf(to.relayer.address);
                        const feeRecipientAfter =
                            await toUsdc.contract.balanceOf(EVM_FEE_RECIPIENT);

                        assert.isTrue(
                            etherAfter
                                .sub(etherBefore)
                                .eq(ethers.BigNumber.from(localVariables["gasDropoff"])),
                        );
                        assert.isTrue(
                            balanceAfter
                                .sub(balanceBefore)
                                .eq(ethers.BigNumber.from(localVariables["amountIn"])),
                        );
                        assert.isTrue(relayerAfter.sub(relayerBefore).eq(ethers.BigNumber.from(0)));
                        assert.isTrue(
                            feeRecipientAfter
                                .sub(feeRecipientBefore)
                                .eq(ethers.BigNumber.from(localVariables["relayingFee"])),
                        );

                        localVariables = {};
                    });
                });
            });

            describe("Gas", function () {
                describe("Direct", function () {
                    it("Outbound", async function () {
                        const amountIn = ethers.utils.parseEther("1"); // 1 Ether
                        const amountOut = 3_700_000_000n; // 3.7k USDC
                        const targetAmountOut = BigInt(ethers.utils.parseEther(".75").toString()); // .75 Ether
                        const currentBlockTime = await from.provider
                            .getBlock("latest")
                            .then((b) => b.timestamp);

                        const output: InitiateArgs = {
                            transferMode: {
                                mode: "LiquidityLayer",
                            },
                            redeemMode: {
                                mode: "Direct",
                            },
                            outputToken: {
                                type: "Gas",
                                swap: {
                                    deadline: currentBlockTime + 60,
                                    limitAmount: targetAmountOut,
                                    type: {
                                        id: "UniswapV3",
                                        firstPoolId: 500,
                                        path: [],
                                    },
                                },
                            },
                            isExactIn: true,
                            inputToken: {
                                type: "Gas",
                                swap: {
                                    deadline: currentBlockTime + 60,
                                    limitAmount: amountOut,
                                    type: {
                                        id: "UniswapV3",
                                        firstPoolId: 500,
                                        path: [],
                                    },
                                },
                            },
                        };

                        const balanceBefore = await from.wallet.getBalance();

                        const { orderResponse, receipt } = await initiateOnEvmSwapLayer(
                            encodeInitiateArgs(output),
                            toUniversal(fromChain, to.wallet.address),
                            fromChain,
                            toChain,
                            from.contract,
                            { value: amountIn },
                        );

                        const balanceAfter = await from.wallet.getBalance();
                        assert.isTrue(
                            balanceBefore
                                .sub(balanceAfter)
                                .eq(amountIn.add(receipt.effectiveGasPrice.mul(receipt.gasUsed))),
                        );

                        localVariables["orderResponse"] = orderResponse;
                        localVariables["amountOut"] = targetAmountOut;
                    });

                    it("Inbound", async function () {
                        const minAmountOut = ethers.BigNumber.from(localVariables["amountOut"]);
                        const etherBefore = await to.provider.getBalance(to.wallet.address);

                        // Perform the direct redeem.
                        const receipt = await to.contract
                            .redeem([], localVariables["orderResponse"])
                            .then((tx) => tx.wait());

                        const etherAfter = await to.provider.getBalance(to.wallet.address);

                        assert.isTrue(
                            etherAfter
                                .sub(etherBefore)
                                .gt(
                                    minAmountOut.sub(
                                        receipt.effectiveGasPrice.mul(receipt.gasUsed),
                                    ),
                                ),
                        );

                        localVariables = {};
                    });
                });

                describe("Relay", function () {
                    it("Outbound", async function () {
                        const amountIn = ethers.utils.parseEther("1"); // 1 Ether
                        const amountOut = 3_700_000_000n; // 3.7k USDC
                        const targetAmountOut = BigInt(ethers.utils.parseEther(".75").toString()); // .75 Ether
                        const currentBlockTime = await from.provider
                            .getBlock("latest")
                            .then((b) => b.timestamp);

                        let relayingFee: bigint = await from.contract
                            .batchQueries(
                                encodeQueriesBatch([
                                    {
                                        query: "RelayingFee",
                                        chain: toChain,
                                        gasDropoff: 0n,
                                        outputToken: {
                                            type: "Gas",
                                            swapType: "UniswapV3",
                                            swapCount: 1,
                                        },
                                    },
                                ]),
                            )
                            .then((encodedFee) => BigInt(encodedFee));

                        const output: InitiateArgs = {
                            transferMode: {
                                mode: "LiquidityLayer",
                            },
                            redeemMode: {
                                mode: "Relay",
                                gasDropoff: 0n,
                                maxRelayingFee: relayingFee,
                            },
                            outputToken: {
                                type: "Gas",
                                swap: {
                                    deadline: currentBlockTime + 60,
                                    limitAmount: targetAmountOut,
                                    type: {
                                        id: "UniswapV3",
                                        firstPoolId: 500,
                                        path: [],
                                    },
                                },
                            },
                            isExactIn: true,
                            inputToken: {
                                type: "Gas",
                                swap: {
                                    deadline: currentBlockTime + 60,
                                    limitAmount: amountOut - relayingFee,
                                    type: {
                                        id: "UniswapV3",
                                        firstPoolId: 500,
                                        path: [],
                                    },
                                },
                            },
                        };

                        const balanceBefore = await from.wallet.getBalance();

                        const { orderResponse, receipt } = await initiateOnEvmSwapLayer(
                            encodeInitiateArgs(output),
                            toUniversal(fromChain, to.wallet.address),
                            fromChain,
                            toChain,
                            from.contract,
                            { value: amountIn },
                        );

                        const balanceAfter = await from.wallet.getBalance();
                        assert.isTrue(
                            balanceBefore
                                .sub(balanceAfter)
                                .eq(amountIn.add(receipt.effectiveGasPrice.mul(receipt.gasUsed))),
                        );

                        localVariables["orderResponse"] = orderResponse;
                        localVariables["amountOut"] = targetAmountOut;
                        localVariables["relayingFee"] = relayingFee;
                    });

                    it("Inbound", async function () {
                        const minAmountOut = ethers.BigNumber.from(localVariables["amountOut"]);
                        const etherBefore = await to.provider.getBalance(to.wallet.address);
                        const feeRecipientBefore =
                            await toUsdc.contract.balanceOf(EVM_FEE_RECIPIENT);

                        // Perform the relay from the relayer wallet.
                        const receipt = await to.contract
                            .connect(to.relayer)
                            .redeem([], localVariables["orderResponse"], {
                                value: localVariables["gasDropoff"],
                            })
                            .then((tx) => tx.wait());

                        const etherAfter = await to.provider.getBalance(to.wallet.address);
                        const feeRecipientAfter =
                            await toUsdc.contract.balanceOf(EVM_FEE_RECIPIENT);

                        assert.isTrue(etherAfter.sub(etherBefore).gt(minAmountOut));
                        assert.isTrue(
                            feeRecipientAfter
                                .sub(feeRecipientBefore)
                                .eq(ethers.BigNumber.from(localVariables["relayingFee"])),
                        );

                        localVariables = {};
                    });
                });
            });
        });
    }

    before("Set up Token Accounts", async function () {
        await splToken.getOrCreateAssociatedTokenAccount(
            connection,
            solanaPayer,
            USDC_MINT_ADDRESS,
            solanaRecipient.publicKey,
        );

        await splToken.getOrCreateAssociatedTokenAccount(
            connection,
            solanaPayer,
            USDC_MINT_ADDRESS,
            solanaRelayer.publicKey,
        );

        await splToken.getOrCreateAssociatedTokenAccount(
            connection,
            solanaPayer,
            USDC_MINT_ADDRESS,
            solanaFeeRecipient.publicKey,
        );

        await splToken.getOrCreateAssociatedTokenAccount(
            connection,
            solanaPayer,
            USDT_MINT_ADDRESS,
            solanaRecipient.publicKey,
        );
    });

    before("Setup Lookup Table", async function () {
        const usdcCommonAccounts = await solanaTokenRouter.commonAccounts();

        tokenRouterLkupTable = await createLut(
            connection,
            solanaPayer,
            Object.values(usdcCommonAccounts).filter((key) => key !== undefined),
        );
    });

    before("Transfer Lamports to Relayer", async function () {
        await expectIxOk(
            connection,
            [
                SystemProgram.transfer({
                    fromPubkey: solanaPayer.publicKey,
                    toPubkey: solanaRelayer.publicKey,
                    lamports: 10000000000,
                }),
            ],
            [solanaPayer],
        );
    });

    before("Generate ATAs", async function () {
        for (const mint of [solanaSwapLayer.usdcMint, USDT_MINT_ADDRESS, splToken.NATIVE_MINT]) {
            for (let i = 0; i < 8; ++i) {
                await createAta(
                    connection,
                    solanaPayer,
                    mint,
                    jupiterV6.programAuthorityAddress(i),
                );
            }
        }

        const payerWsol = splToken.getAssociatedTokenAddressSync(
            splToken.NATIVE_MINT,
            solanaPayer.publicKey,
            false,
            splToken.TOKEN_PROGRAM_ID,
        );

        await expectIxOk(
            connection,
            [
                splToken.createAssociatedTokenAccountInstruction(
                    solanaPayer.publicKey,
                    payerWsol,
                    solanaPayer.publicKey,
                    splToken.NATIVE_MINT,
                    splToken.TOKEN_PROGRAM_ID,
                ),
                SystemProgram.transfer({
                    fromPubkey: solanaPayer.publicKey,
                    toPubkey: payerWsol,
                    lamports: 2_000_000_000_000n,
                }),
                splToken.createSyncNativeInstruction(payerWsol, splToken.TOKEN_PROGRAM_ID),
            ],
            [solanaPayer],
        );
    });

    describe("Solana <> Ethereum", function () {
        const toChain = "Ethereum";

        // From contracts.
        const to = evmSwapLayerConfig(toChain);
        const toUsdc = usdcContract(toChain);
        const toUsdt = usdtContract();

        describe("Usdc", function () {
            describe("Direct", function () {
                it("Outbound", async function () {
                    const amountIn = 20_000_000_000n; // 20k USDC
                    const senderBefore = await getUsdcAtaBalance(connection, solanaPayer.publicKey);

                    const orderResponse = await initiateOnSolanaSwapLayer(
                        solanaSwapLayer,
                        solanaPayer,
                        amountIn,
                        toChain,
                        toUniversal(toChain, to.wallet.address),
                        {},
                    );

                    // Confirm that the 20k was staged.
                    const senderAfter = await getUsdcAtaBalance(connection, solanaPayer.publicKey);
                    assert.equal(senderBefore - senderAfter, amountIn);

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["amountIn"] = amountIn;
                });

                it("Inbound", async function () {
                    const balanceBefore = await toUsdc.contract.balanceOf(to.wallet.address);
                    const etherBefore = await to.provider.getBalance(to.wallet.address);

                    // Perform the direct redeem.
                    const receipt = await to.contract
                        .redeem([], localVariables["orderResponse"])
                        .then((tx) => tx.wait());

                    const balanceAfter = await toUsdc.contract.balanceOf(to.wallet.address);
                    const etherAfter = await to.provider.getBalance(to.wallet.address);

                    assert.isTrue(
                        etherBefore
                            .sub(etherAfter)
                            .eq(receipt.effectiveGasPrice.mul(receipt.gasUsed)),
                    );
                    assert.equal(
                        balanceAfter.sub(balanceBefore).toNumber(),
                        localVariables["amountIn"],
                    );

                    localVariables = {};
                });
            });

            describe("Relay", function () {
                it("Outbound", async function () {
                    const amountIn = 20_000_000_000n; // 20k USDC
                    const denormGasDropoff = ONE_SOL;

                    // Calculate the relayer fee.
                    const peer = await solanaSwapLayer.fetchPeer(toChainId(toChain));
                    const expectedRelayerFee = swapLayerSdk.calculateRelayerFee(
                        peer.relayParams,
                        BigInt(denormGasDropoff),
                        { type: "Usdc" },
                    );

                    const senderBefore = await getUsdcAtaBalance(connection, solanaPayer.publicKey);

                    const orderResponse = await initiateOnSolanaSwapLayer(
                        solanaSwapLayer,
                        solanaPayer,
                        amountIn,
                        toChain,
                        toUniversal(toChain, to.wallet.address),
                        {},
                        {
                            redeemOption: {
                                relay: {
                                    gasDropoff: denormGasDropoff / 1000, // normalize by 1e3
                                    maxRelayerFee: new BN(expectedRelayerFee.toString()),
                                },
                            },
                        },
                    );

                    // Confirm that the 20k was staged.
                    const senderAfter = await getUsdcAtaBalance(connection, solanaPayer.publicKey);
                    assert.equal(senderBefore - senderAfter, BigInt(amountIn) + expectedRelayerFee);

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["amountIn"] = amountIn;
                    localVariables["gasDropoff"] = denormGasDropoff;
                    localVariables["relayingFee"] = expectedRelayerFee;
                });

                it("Inbound", async function () {
                    const balanceBefore = await toUsdc.contract.balanceOf(to.wallet.address);
                    const etherBefore = await to.provider.getBalance(to.wallet.address);
                    const relayerBefore = await toUsdc.contract.balanceOf(to.relayer.address);
                    const feeRecipientBefore = await toUsdc.contract.balanceOf(EVM_FEE_RECIPIENT);

                    // Since the gasDropoff was specified on Solana (i.e., in SOL terms) we
                    // need to multiply by 1e9.
                    const gasDropoff = BigInt(localVariables["gasDropoff"]) * BigInt(1e9);

                    // Perform the relay from the relayer wallet.
                    await to.contract
                        .connect(to.relayer)
                        .redeem([], localVariables["orderResponse"], { value: gasDropoff })
                        .then((tx) => tx.wait());

                    const balanceAfter = await toUsdc.contract.balanceOf(to.wallet.address);
                    const etherAfter = await to.provider.getBalance(to.wallet.address);
                    const relayerAfter = await toUsdc.contract.balanceOf(to.relayer.address);
                    const feeRecipientAfter = await toUsdc.contract.balanceOf(EVM_FEE_RECIPIENT);

                    assert.isTrue(
                        etherAfter.sub(etherBefore).eq(ethers.BigNumber.from(gasDropoff)),
                    );
                    assert.isTrue(
                        balanceAfter
                            .sub(balanceBefore)
                            .eq(ethers.BigNumber.from(localVariables["amountIn"])),
                    );
                    assert.isTrue(relayerAfter.sub(relayerBefore).eq(ethers.BigNumber.from(0)));
                    assert.isTrue(
                        feeRecipientAfter
                            .sub(feeRecipientBefore)
                            .eq(ethers.BigNumber.from(localVariables["relayingFee"])),
                    );

                    localVariables = {};
                });
            });
        });

        describe("Gas", function () {
            describe("Direct", function () {
                it("Outbound", async function () {
                    const amountIn = 1_000_000_000n; // 1 SOL
                    const amountOut = 140_000_000n; // 140 USDC
                    const targetAmountOut = 25_000_000_000_000_000n; // 0.025 ETH
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        splToken.NATIVE_MINT,
                        solanaPayer.publicKey,
                    );

                    const currentBlockTime = await to.provider
                        .getBlock("latest")
                        .then((b) => b.timestamp);

                    const outputToken: swapLayerSdk.OutputToken = {
                        type: "Gas",
                        swap: {
                            deadline: currentBlockTime + 60,
                            limitAmount: targetAmountOut,
                            type: {
                                id: "UniswapV3",
                                firstPoolId: 500,
                                path: [],
                            },
                        },
                    };

                    const orderResponse = await initiateOnSolanaSwapLayer(
                        solanaSwapLayer,
                        solanaPayer,
                        amountIn,
                        toChain,
                        toUniversal(toChain, to.wallet.address),
                        { senderToken, srcMint: splToken.NATIVE_MINT },
                        {
                            transferType: "native",
                            outputToken: outputToken,
                            exactIn: true,
                            inAmount: amountIn,
                            quotedOutAmount: amountOut,
                            slippageBps: 200,
                            swapResponseModifier: modifyWsolToUsdcSwapResponseForTest,
                        },
                    );

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["amountOut"] = targetAmountOut;
                });

                it("Inbound", async function () {
                    const minAmountOut = ethers.BigNumber.from(localVariables["amountOut"]);
                    const etherBefore = await to.provider.getBalance(to.wallet.address);

                    // Perform the direct redeem.
                    const receipt = await to.contract
                        .redeem([], localVariables["orderResponse"])
                        .then((tx) => tx.wait());

                    const etherAfter = await to.provider.getBalance(to.wallet.address);
                    const gasUsed = receipt.effectiveGasPrice.mul(receipt.gasUsed);
                    assert.isTrue(etherAfter.add(gasUsed).sub(etherBefore).gt(minAmountOut));

                    localVariables = {};
                });
            });

            describe("Relay", function () {
                it("Outbound", async function () {
                    const amountIn = 1_000_000_000n; // 1 SOL
                    const amountOut = 140_000_000n; // 140 USDC
                    const targetAmountOut = 25_000_000_000_000_000n; // 0.025 ETH
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        splToken.NATIVE_MINT,
                        solanaPayer.publicKey,
                    );
                    const currentBlockTime = await to.provider
                        .getBlock("latest")
                        .then((b) => b.timestamp);

                    const outputToken: swapLayerSdk.OutputToken = {
                        type: "Gas",
                        swap: {
                            deadline: currentBlockTime + 60,
                            limitAmount: targetAmountOut,
                            type: {
                                id: "UniswapV3",
                                firstPoolId: 500,
                                path: [],
                            },
                        },
                    };

                    // Calculate the relayer fee.
                    const peer = await solanaSwapLayer.fetchPeer(toChainId(toChain));
                    const expectedRelayerFee = swapLayerSdk.calculateRelayerFee(
                        peer.relayParams,
                        0n,
                        outputToken,
                    );

                    const orderResponse = await initiateOnSolanaSwapLayer(
                        solanaSwapLayer,
                        solanaPayer,
                        amountIn,
                        toChain,
                        toUniversal(toChain, to.wallet.address),
                        { senderToken, srcMint: splToken.NATIVE_MINT },
                        {
                            transferType: "native",
                            outputToken: outputToken,
                            redeemOption: {
                                relay: { gasDropoff: 0, maxRelayerFee: expectedRelayerFee },
                            },
                            exactIn: true,
                            inAmount: amountIn,
                            quotedOutAmount: amountOut,
                            slippageBps: 200,
                            swapResponseModifier: modifyWsolToUsdcSwapResponseForTest,
                        },
                    );

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["amountOut"] = targetAmountOut;
                    localVariables["relayingFee"] = expectedRelayerFee;
                });

                it("Inbound", async function () {
                    const minAmountOut = ethers.BigNumber.from(
                        localVariables["amountOut"].toString(),
                    );
                    const etherBefore = await to.provider.getBalance(to.wallet.address);
                    const feeRecipientBefore = await toUsdc.contract.balanceOf(EVM_FEE_RECIPIENT);

                    // Perform the relay from the relayer wallet.
                    const receipt = await to.contract
                        .connect(to.relayer)
                        .redeem([], localVariables["orderResponse"], {
                            value: localVariables["gasDropoff"],
                        })
                        .then((tx) => tx.wait());

                    const etherAfter = await to.provider.getBalance(to.wallet.address);
                    const feeRecipientAfter = await toUsdc.contract.balanceOf(EVM_FEE_RECIPIENT);

                    assert.isTrue(etherAfter.sub(etherBefore).gt(minAmountOut));
                    assert.isTrue(
                        feeRecipientAfter
                            .sub(feeRecipientBefore)
                            .eq(ethers.BigNumber.from(localVariables["relayingFee"])),
                    );

                    localVariables = {};
                });
            });
        });

        describe("Other", function () {
            describe("Direct", function () {
                it("Outbound", async function () {
                    const amountIn = 50_000_000n; // 50 USDT
                    const amountOut = 49_800_000n; // 49.8 USDC
                    const targetAmountOut = 49_600_000n; // 49.6 USDT
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        USDT_MINT_ADDRESS,
                        solanaPayer.publicKey,
                    );

                    const currentBlockTime = await to.provider
                        .getBlock("latest")
                        .then((b) => b.timestamp);

                    const outputToken: swapLayerSdk.OutputToken = {
                        type: "Other",
                        address: toUniversal(toChain, USDT_ETH),
                        swap: {
                            deadline: currentBlockTime + 60,
                            limitAmount: targetAmountOut,
                            type: {
                                id: "UniswapV3",
                                firstPoolId: 500,
                                path: [],
                            },
                        },
                    };

                    // Fetch usdt balance before.
                    const senderBefore = await getUsdtAtaBalance(connection, solanaPayer.publicKey);

                    const orderResponse = await initiateOnSolanaSwapLayer(
                        solanaSwapLayer,
                        solanaPayer,
                        amountIn,
                        toChain,
                        toUniversal(toChain, to.wallet.address),
                        { senderToken, srcMint: USDT_MINT_ADDRESS },
                        {
                            transferType: "sender",
                            outputToken: outputToken,
                            exactIn: true,
                            inAmount: amountIn,
                            quotedOutAmount: amountOut,
                            slippageBps: 50,
                            swapResponseModifier: modifyUsdtToUsdcSwapResponseForTest,
                        },
                    );

                    const senderAfter = await getUsdtAtaBalance(connection, solanaPayer.publicKey);
                    assert.equal(senderBefore - senderAfter, amountIn);

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["amountOut"] = targetAmountOut;
                });

                it("Inbound", async function () {
                    const minAmountOut = ethers.BigNumber.from(localVariables["amountOut"]);
                    const balanceBefore = await getUsdtBalanceEthereum(to.wallet);

                    // Perform the direct redeem.
                    const receipt = await to.contract
                        .redeem([], localVariables["orderResponse"])
                        .then((tx) => tx.wait());

                    const balanceAfter = await getUsdtBalanceEthereum(to.wallet);
                    assert.isTrue(balanceAfter.sub(balanceBefore).gte(minAmountOut));

                    localVariables = {};
                });
            });

            describe("Relay", function () {
                it("Outbound", async function () {
                    const amountIn = 50_000_000n; // 50 USDT
                    const amountOut = 49_800_000n; // 49.8 USDC
                    const targetAmountOut = 49_000_000n; // 49.6 USDT (account for relayer fee)
                    const senderToken = splToken.getAssociatedTokenAddressSync(
                        USDT_MINT_ADDRESS,
                        solanaPayer.publicKey,
                    );

                    const currentBlockTime = await to.provider
                        .getBlock("latest")
                        .then((b) => b.timestamp);

                    const outputToken: swapLayerSdk.OutputToken = {
                        type: "Other",
                        address: toUniversal(toChain, USDT_ETH),
                        swap: {
                            deadline: currentBlockTime + 60,
                            limitAmount: targetAmountOut,
                            type: {
                                id: "UniswapV3",
                                firstPoolId: 500,
                                path: [],
                            },
                        },
                    };

                    // Calculate the relayer fee.
                    const peer = await solanaSwapLayer.fetchPeer(toChainId(toChain));
                    const expectedRelayerFee = swapLayerSdk.calculateRelayerFee(
                        peer.relayParams,
                        0n,
                        outputToken,
                    );

                    // Fetch usdt balance before.
                    const senderBefore = await getUsdtAtaBalance(connection, solanaPayer.publicKey);

                    const orderResponse = await initiateOnSolanaSwapLayer(
                        solanaSwapLayer,
                        solanaPayer,
                        amountIn,
                        toChain,
                        toUniversal(toChain, to.wallet.address),
                        { senderToken, srcMint: USDT_MINT_ADDRESS },
                        {
                            transferType: "sender",
                            outputToken: outputToken,
                            redeemOption: {
                                relay: { gasDropoff: 0, maxRelayerFee: expectedRelayerFee },
                            },
                            exactIn: true,
                            inAmount: amountIn,
                            quotedOutAmount: amountOut,
                            slippageBps: 50,
                            swapResponseModifier: modifyUsdtToUsdcSwapResponseForTest,
                        },
                    );

                    const senderAfter = await getUsdtAtaBalance(connection, solanaPayer.publicKey);
                    assert.equal(senderBefore - senderAfter, amountIn);

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["amountOut"] = targetAmountOut;
                    localVariables["relayingFee"] = expectedRelayerFee;
                });

                it("Inbound", async function () {
                    const minAmountOut = ethers.BigNumber.from(
                        localVariables["amountOut"].toString(),
                    );
                    const balanceBefore = await toUsdt.contract.balanceOf(to.wallet.address);
                    const feeRecipientBefore = await toUsdc.contract.balanceOf(EVM_FEE_RECIPIENT);

                    // Perform the relay from the relayer wallet.
                    const receipt = await to.contract
                        .connect(to.relayer)
                        .redeem([], localVariables["orderResponse"], {
                            value: localVariables["gasDropoff"],
                        })
                        .then((tx) => tx.wait());

                    const balanceAfter = await toUsdt.contract.balanceOf(to.wallet.address);
                    const feeRecipientAfter = await toUsdc.contract.balanceOf(EVM_FEE_RECIPIENT);

                    assert.isTrue(balanceAfter.sub(balanceBefore).gt(minAmountOut));
                    assert.isTrue(
                        feeRecipientAfter
                            .sub(feeRecipientBefore)
                            .eq(ethers.BigNumber.from(localVariables["relayingFee"])),
                    );

                    localVariables = {};
                });
            });
        });
    });

    describe("Ethereum <> Solana", function () {
        const fromChain = "Ethereum";
        const toChain = "Solana";

        // From contracts.
        const from = evmSwapLayerConfig(fromChain);
        const fromConfig = EVM_CONFIG[fromChain];
        const fromUsdc = usdcContract(fromChain);

        describe("Usdc", function () {
            describe("Direct", function () {
                it("Outbound", async function () {
                    const amountIn = 20_000_000_000; // 20k USDC

                    const output: InitiateArgs = {
                        transferMode: {
                            mode: "LiquidityLayer",
                        },
                        redeemMode: {
                            mode: "Direct",
                        },
                        outputToken: {
                            type: "Usdc",
                        },
                        isExactIn: true,
                        inputToken: {
                            type: "Usdc",
                            amount: BigInt(amountIn),
                            acquireMode: {
                                mode: "Preapproved",
                            },
                        },
                    };

                    const balanceBefore = await fromUsdc.contract.balanceOf(from.wallet.address);

                    const { orderResponse } = await initiateOnEvmSwapLayer(
                        encodeInitiateArgs(output),
                        toUniversal(toChain, solanaRecipient.publicKey.toBuffer()),
                        fromChain,
                        toChain,
                        from.contract,
                    );

                    const balanceAfter = await fromUsdc.contract.balanceOf(from.wallet.address);
                    assert.equal(balanceBefore.sub(balanceAfter).toNumber(), amountIn);

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["amountIn"] = amountIn;
                });

                it("Inbound", async function () {
                    // Post the Fill on Solana and derive the account.
                    const vaaKey = await postSignedVaa(
                        connection,
                        solanaPayer,
                        localVariables["orderResponse"].encodedWormholeMessage,
                    );

                    // Redeem fill on Solana.
                    const preparedFill = await redeemFillOnSolana(
                        connection,
                        solanaPayer,
                        solanaTokenRouter,
                        tokenRouterLkupTable,
                        {
                            vaa: vaaKey,
                        },
                        {
                            encodedCctpMessage: localVariables["orderResponse"].circleBridgeMessage,
                            cctpAttestation: localVariables["orderResponse"].circleAttestation,
                        },
                    );

                    const recipientBefore = await getUsdcAtaBalance(
                        connection,
                        solanaRecipient.publicKey,
                    );

                    const transferIx = await solanaSwapLayer.completeTransferDirectIx(
                        {
                            payer: solanaPayer.publicKey,
                            preparedFill,
                            recipient: solanaRecipient.publicKey,
                        },
                        toChainId(fromChain),
                    );

                    await expectIxOk(connection, [transferIx], [solanaPayer]);

                    const recipientAfter = await getUsdcAtaBalance(
                        connection,
                        solanaRecipient.publicKey,
                    );
                    assert.equal(
                        recipientAfter,
                        recipientBefore + BigInt(localVariables["amountIn"]),
                    );

                    localVariables = {};
                });
            });

            describe("Relay", function () {
                it("Outbound", async function () {
                    const amountIn = 20_000_000_000; // 20k USDC
                    const gasDropoff = BigInt(ONE_ETHER);

                    let relayingFee = await from.contract
                        .batchQueries(
                            encodeQueriesBatch([
                                {
                                    query: "RelayingFee",
                                    chain: toChain,
                                    gasDropoff,
                                    outputToken: { type: "Usdc" },
                                },
                            ]),
                        )
                        .then((encodedFee) => Number(encodedFee));

                    const output: InitiateArgs = {
                        transferMode: {
                            mode: "LiquidityLayer",
                        },
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff,
                            maxRelayingFee: relayingFee,
                        },
                        outputToken: {
                            type: "Usdc",
                        },
                        isExactIn: false,
                        inputToken: {
                            type: "Usdc",
                            amount: BigInt(amountIn),
                            acquireMode: {
                                mode: "Preapproved",
                            },
                        },
                    };

                    const balanceBefore = await fromUsdc.contract.balanceOf(from.wallet.address);

                    const { orderResponse } = await initiateOnEvmSwapLayer(
                        encodeInitiateArgs(output),
                        toUniversal(toChain, solanaRecipient.publicKey.toBuffer()),
                        fromChain,
                        toChain,
                        from.contract,
                    );

                    const balanceAfter = await fromUsdc.contract.balanceOf(from.wallet.address);
                    assert.equal(
                        balanceBefore.sub(balanceAfter).toNumber(),
                        amountIn + relayingFee,
                    );

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["amountIn"] = amountIn;
                    localVariables["relayingFee"] = relayingFee;
                    localVariables["gasDropoff"] = gasDropoff;
                });

                it("Inbound", async function () {
                    // Post the Fill on Solana and derive the account.
                    const vaaKey = await postSignedVaa(
                        connection,
                        solanaRelayer,
                        localVariables["orderResponse"].encodedWormholeMessage,
                    );

                    // Redeem fill on Solana.
                    const preparedFill = await redeemFillOnSolana(
                        connection,
                        solanaRelayer,
                        solanaTokenRouter,
                        tokenRouterLkupTable,
                        {
                            vaa: vaaKey,
                        },
                        {
                            encodedCctpMessage: localVariables["orderResponse"].circleBridgeMessage,
                            cctpAttestation: localVariables["orderResponse"].circleAttestation,
                        },
                    );

                    const recipientBefore = await getUsdcAtaBalance(
                        connection,
                        solanaRecipient.publicKey,
                    );
                    const recipientLamportBefore = await connection.getBalance(
                        solanaRecipient.publicKey,
                    );
                    const feeRecipientBefore = await getUsdcAtaBalance(
                        connection,
                        solanaFeeRecipient.publicKey,
                    );

                    const transferIx = await solanaSwapLayer.completeTransferRelayIx(
                        {
                            payer: solanaRelayer.publicKey,
                            preparedFill,
                            recipient: solanaRecipient.publicKey,
                        },
                        toChainId(fromChain),
                    );

                    await expectIxOk(connection, [transferIx], [solanaRelayer]);

                    const recipientAfter = await getUsdcAtaBalance(
                        connection,
                        solanaRecipient.publicKey,
                    );
                    const recipientLamportAfter = await connection.getBalance(
                        solanaRecipient.publicKey,
                    );
                    const feeRecipientAfter = await getUsdcAtaBalance(
                        connection,
                        solanaFeeRecipient.publicKey,
                    );

                    // Confirm the balance changes. Since we're coming from EVM to Solana,
                    // we need to scale the gas dropoff by 1e9.
                    const gasDropoff = Number(localVariables["gasDropoff"] / BigInt(1e9));
                    const relayingFee = BigInt(localVariables["relayingFee"]);
                    const amountIn = BigInt(localVariables["amountIn"]);

                    assert.equal(recipientAfter - recipientBefore, amountIn);
                    assert.equal(recipientLamportAfter - recipientLamportBefore, gasDropoff);
                    assert.equal(feeRecipientAfter, feeRecipientBefore + relayingFee);
                });
            });
        });

        describe("Gas", function () {
            describe("Direct", function () {
                it("Outbound", async function () {
                    const amountIn = ethers.utils.parseEther("0.1"); // .1 Ether
                    const amountOut = 370_000_000n; // 370 USDC
                    const targetMinAmountOut = 1_900_000_000n; // 1.9 SOL
                    const currentBlockTime = await from.provider
                        .getBlock("latest")
                        .then((b) => b.timestamp);

                    const output: InitiateArgs = {
                        transferMode: {
                            mode: "LiquidityLayer",
                        },
                        redeemMode: {
                            mode: "Direct",
                        },
                        outputToken: {
                            type: "Gas",
                            swap: {
                                deadline: 0,
                                limitAmount: targetMinAmountOut,
                                type: {
                                    id: "GenericSolana",
                                    dexProgramId: { isSome: false },
                                },
                            },
                        },
                        isExactIn: true,
                        inputToken: {
                            type: "Gas",
                            swap: {
                                deadline: currentBlockTime + 60,
                                limitAmount: amountOut,
                                type: {
                                    id: "UniswapV3",
                                    firstPoolId: 500,
                                    path: [],
                                },
                            },
                        },
                    };

                    const balanceBefore = await from.wallet.getBalance();

                    const { orderResponse, receipt } = await initiateOnEvmSwapLayer(
                        encodeInitiateArgs(output),
                        toUniversal(toChain, solanaRecipient.publicKey.toBuffer()),
                        fromChain,
                        toChain,
                        from.contract,
                        { value: amountIn },
                    );

                    const balanceAfter = await from.wallet.getBalance();
                    assert.isTrue(
                        balanceBefore
                            .sub(balanceAfter)
                            .eq(amountIn.add(receipt.effectiveGasPrice.mul(receipt.gasUsed))),
                    );

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["limitAmount"] = targetMinAmountOut;
                });

                it("Inbound", async function () {
                    // Post the Fill on Solana and derive the account.
                    const vaaKey = await postSignedVaa(
                        connection,
                        solanaRelayer,
                        localVariables["orderResponse"].encodedWormholeMessage,
                    );

                    // Redeem fill on Solana.
                    const preparedFill = await redeemFillOnSolana(
                        connection,
                        solanaRelayer,
                        solanaTokenRouter,
                        tokenRouterLkupTable,
                        {
                            vaa: vaaKey,
                        },
                        {
                            encodedCctpMessage: localVariables["orderResponse"].circleBridgeMessage,
                            cctpAttestation: localVariables["orderResponse"].circleAttestation,
                        },
                    );

                    const recipientBefore = await connection.getBalance(solanaRecipient.publicKey);

                    await completeSwapForTest(
                        solanaSwapLayer,
                        connection,
                        {
                            payer: solanaPayer.publicKey,
                            preparedFill,
                            recipient: solanaRecipient.publicKey,
                        },
                        {
                            redeemMode: "direct",
                            signers: [solanaPayer],
                            swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                        },
                    );

                    const recipientAfter = await connection.getBalance(solanaRecipient.publicKey);

                    assert.isTrue(
                        recipientAfter - recipientBefore >= Number(localVariables["limitAmount"]),
                    );
                });
            });

            describe("Relay", function () {
                it("Outbound", async function () {
                    const amountIn = ethers.utils.parseEther("0.1"); // .1 Ether
                    const amountOut = 370_000_000n; // 370 USDC
                    const targetMinAmountOut = 1_900_000_000n; // 1.9 SOL
                    const currentBlockTime = await from.provider
                        .getBlock("latest")
                        .then((b) => b.timestamp);

                    let relayingFee: bigint = await from.contract
                        .batchQueries(
                            encodeQueriesBatch([
                                {
                                    query: "RelayingFee",
                                    chain: toChain,
                                    gasDropoff: 0n,
                                    outputToken: {
                                        type: "Gas",
                                        swapType: "GenericSolana",
                                        swapCount: 1,
                                    },
                                },
                            ]),
                        )
                        .then((encodedFee) => BigInt(encodedFee));

                    const output: InitiateArgs = {
                        transferMode: {
                            mode: "LiquidityLayer",
                        },
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff: 0n,
                            maxRelayingFee: relayingFee,
                        },
                        outputToken: {
                            type: "Gas",
                            swap: {
                                deadline: 0,
                                limitAmount: targetMinAmountOut,
                                type: {
                                    id: "GenericSolana",
                                    dexProgramId: { isSome: false },
                                },
                            },
                        },
                        isExactIn: true,
                        inputToken: {
                            type: "Gas",
                            swap: {
                                deadline: currentBlockTime + 60,
                                limitAmount: amountOut - relayingFee,
                                type: {
                                    id: "UniswapV3",
                                    firstPoolId: 500,
                                    path: [],
                                },
                            },
                        },
                    };

                    const balanceBefore = await from.wallet.getBalance();

                    const { orderResponse, receipt } = await initiateOnEvmSwapLayer(
                        encodeInitiateArgs(output),
                        toUniversal(toChain, solanaRecipient.publicKey.toBuffer()),
                        fromChain,
                        toChain,
                        from.contract,
                        { value: amountIn },
                    );

                    const balanceAfter = await from.wallet.getBalance();
                    assert.isTrue(
                        balanceBefore
                            .sub(balanceAfter)
                            .eq(amountIn.add(receipt.effectiveGasPrice.mul(receipt.gasUsed))),
                    );

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["limitAmount"] = targetMinAmountOut;
                    localVariables["relayingFee"] = relayingFee;
                });

                it("Inbound", async function () {
                    // Post the Fill on Solana and derive the account.
                    const vaaKey = await postSignedVaa(
                        connection,
                        solanaRelayer,
                        localVariables["orderResponse"].encodedWormholeMessage,
                    );

                    // Redeem fill on Solana.
                    const preparedFill = await redeemFillOnSolana(
                        connection,
                        solanaRelayer,
                        solanaTokenRouter,
                        tokenRouterLkupTable,
                        {
                            vaa: vaaKey,
                        },
                        {
                            encodedCctpMessage: localVariables["orderResponse"].circleBridgeMessage,
                            cctpAttestation: localVariables["orderResponse"].circleAttestation,
                        },
                    );

                    const recipientBefore = await connection.getBalance(solanaRecipient.publicKey);
                    const feeRecipientBefore = await getUsdcAtaBalance(
                        connection,
                        solanaFeeRecipient.publicKey,
                    );

                    await completeSwapForTest(
                        solanaSwapLayer,
                        connection,
                        {
                            payer: solanaRelayer.publicKey,
                            preparedFill,
                            recipient: solanaRecipient.publicKey,
                        },
                        {
                            redeemMode: "relay",
                            signers: [solanaRelayer],
                            swapResponseModifier: modifyUsdcToWsolSwapResponseForTest,
                        },
                    );

                    const recipientAfter = await connection.getBalance(solanaRecipient.publicKey);
                    const feeRecipientAfter = await getUsdcAtaBalance(
                        connection,
                        solanaFeeRecipient.publicKey,
                    );

                    assert.isTrue(
                        recipientAfter - recipientBefore >= Number(localVariables["limitAmount"]),
                    );
                    assert.equal(
                        feeRecipientAfter,
                        feeRecipientBefore + localVariables["relayingFee"],
                    );
                });
            });
        });

        describe("Other", function () {
            before("Approve Max", async function () {
                await usdtContract()
                    .contract.connect(from.wallet)
                    .approve(from.contract.address, ethers.constants.MaxUint256)
                    .then((tx) => tx.wait());
            });

            describe("Direct", function () {
                it("Outbound", async function () {
                    const amountIn = 49_600_000n; // 49.6 USDT
                    const amountOut = 49_400_000n; // 49.4 USDC
                    const targetAmountOut = 49_200_000n; // 49.2 USDT
                    const currentBlockTime = await from.provider
                        .getBlock("latest")
                        .then((b) => b.timestamp);

                    const output: InitiateArgs = {
                        transferMode: {
                            mode: "LiquidityLayer",
                        },
                        redeemMode: {
                            mode: "Direct",
                        },
                        outputToken: {
                            type: "Other",
                            address: toUniversal(toChain, USDT_MINT_ADDRESS.toString()),
                            swap: {
                                deadline: 0,
                                limitAmount: targetAmountOut,
                                type: {
                                    id: "GenericSolana",
                                    dexProgramId: { isSome: false },
                                },
                            },
                        },
                        isExactIn: true,
                        inputToken: {
                            type: "Other",
                            address: USDT_ETH,
                            approveCheck: true,
                            acquireMode: {
                                mode: "Preapproved",
                            },
                            amount: BigInt(amountIn),
                            swap: {
                                deadline: currentBlockTime + 60,
                                limitAmount: amountOut,
                                type: {
                                    id: "UniswapV3",
                                    firstPoolId: 500,
                                    path: [],
                                },
                            },
                        },
                    };

                    const balanceBefore = await getUsdtBalanceEthereum(from.wallet);

                    const { orderResponse } = await initiateOnEvmSwapLayer(
                        encodeInitiateArgs(output),
                        toUniversal(toChain, solanaRecipient.publicKey.toBuffer()),
                        fromChain,
                        toChain,
                        from.contract,
                    );

                    const balanceAfter = await getUsdtBalanceEthereum(from.wallet);
                    assert.isTrue(
                        balanceBefore.sub(balanceAfter).eq(ethers.BigNumber.from(amountIn)),
                    );

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["amountOut"] = targetAmountOut;
                });

                it("Inbound", async function () {
                    // Post the Fill on Solana and derive the account.
                    const vaaKey = await postSignedVaa(
                        connection,
                        solanaRelayer,
                        localVariables["orderResponse"].encodedWormholeMessage,
                    );

                    // Redeem fill on Solana.
                    const preparedFill = await redeemFillOnSolana(
                        connection,
                        solanaRelayer,
                        solanaTokenRouter,
                        tokenRouterLkupTable,
                        {
                            vaa: vaaKey,
                        },
                        {
                            encodedCctpMessage: localVariables["orderResponse"].circleBridgeMessage,
                            cctpAttestation: localVariables["orderResponse"].circleAttestation,
                        },
                    );

                    // Fetch usdt balance before.
                    const recipientBefore = await getUsdtAtaBalance(
                        connection,
                        solanaRecipient.publicKey,
                    );

                    await completeSwapForTest(
                        solanaSwapLayer,
                        connection,
                        {
                            payer: solanaPayer.publicKey,
                            preparedFill,
                            recipient: solanaRecipient.publicKey,
                            dstMint: USDT_MINT_ADDRESS,
                        },
                        {
                            redeemMode: "direct",
                            signers: [solanaPayer],
                            quotedAmountOut: localVariables["amountOut"],
                            swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        },
                    );

                    const recipientAfter = await getUsdtAtaBalance(
                        connection,
                        solanaRecipient.publicKey,
                    );
                    assert.isTrue(recipientAfter - recipientBefore >= localVariables["amountOut"]);
                });
            });

            describe("Relay", function () {
                it("Outbound", async function () {
                    const currentBlockTime = await from.provider
                        .getBlock("latest")
                        .then((b) => b.timestamp);

                    let relayingFee: bigint = await from.contract
                        .batchQueries(
                            encodeQueriesBatch([
                                {
                                    query: "RelayingFee",
                                    chain: toChain,
                                    gasDropoff: 0n,
                                    outputToken: {
                                        type: "Other",
                                        swapType: "GenericSolana",
                                        swapCount: 1,
                                    },
                                },
                            ]),
                        )
                        .then((encodedFee) => BigInt(encodedFee));

                    const amountIn = 49_000_000n; // 49 USDT
                    const targetAmountOut = 47_800_000n; // 47.8 USDT (account for relaying fee)
                    const amountOut = amountIn - relayingFee - 500_000n;

                    const output: InitiateArgs = {
                        transferMode: {
                            mode: "LiquidityLayer",
                        },
                        redeemMode: {
                            mode: "Relay",
                            gasDropoff: 0n,
                            maxRelayingFee: relayingFee,
                        },
                        outputToken: {
                            type: "Other",
                            address: toUniversal(toChain, USDT_MINT_ADDRESS.toString()),
                            swap: {
                                deadline: 0,
                                limitAmount: targetAmountOut,
                                type: {
                                    id: "GenericSolana",
                                    dexProgramId: { isSome: false },
                                },
                            },
                        },
                        isExactIn: true,
                        inputToken: {
                            type: "Other",
                            address: USDT_ETH,
                            approveCheck: true,
                            acquireMode: {
                                mode: "Preapproved",
                            },
                            amount: BigInt(amountIn),
                            swap: {
                                deadline: currentBlockTime + 60,
                                limitAmount: amountOut,
                                type: {
                                    id: "UniswapV3",
                                    firstPoolId: 500,
                                    path: [],
                                },
                            },
                        },
                    };

                    const balanceBefore = await getUsdtBalanceEthereum(from.wallet);

                    const { orderResponse } = await initiateOnEvmSwapLayer(
                        encodeInitiateArgs(output),
                        toUniversal(toChain, solanaRecipient.publicKey.toBuffer()),
                        fromChain,
                        toChain,
                        from.contract,
                    );

                    const balanceAfter = await getUsdtBalanceEthereum(from.wallet);
                    assert.isTrue(
                        balanceBefore.sub(balanceAfter).eq(ethers.BigNumber.from(amountIn)),
                    );

                    localVariables["orderResponse"] = orderResponse;
                    localVariables["amountOut"] = targetAmountOut;
                    localVariables["relayingFee"] = relayingFee;
                });

                it("Inbound", async function () {
                    // Post the Fill on Solana and derive the account.
                    const vaaKey = await postSignedVaa(
                        connection,
                        solanaRelayer,
                        localVariables["orderResponse"].encodedWormholeMessage,
                    );

                    // Redeem fill on Solana.
                    const preparedFill = await redeemFillOnSolana(
                        connection,
                        solanaRelayer,
                        solanaTokenRouter,
                        tokenRouterLkupTable,
                        {
                            vaa: vaaKey,
                        },
                        {
                            encodedCctpMessage: localVariables["orderResponse"].circleBridgeMessage,
                            cctpAttestation: localVariables["orderResponse"].circleAttestation,
                        },
                    );

                    // Fetch usdt balance before.
                    const recipientBefore = await getUsdtAtaBalance(
                        connection,
                        solanaRecipient.publicKey,
                    );
                    const feeRecipientBefore = await getUsdcAtaBalance(
                        connection,
                        solanaFeeRecipient.publicKey,
                    );

                    await completeSwapForTest(
                        solanaSwapLayer,
                        connection,
                        {
                            payer: solanaPayer.publicKey,
                            preparedFill,
                            recipient: solanaRecipient.publicKey,
                            dstMint: USDT_MINT_ADDRESS,
                        },
                        {
                            redeemMode: "relay",
                            signers: [solanaPayer],
                            quotedAmountOut: localVariables["amountOut"],
                            swapResponseModifier: modifyUsdcToUsdtSwapResponseForTest,
                        },
                    );

                    const recipientAfter = await getUsdtAtaBalance(
                        connection,
                        solanaRecipient.publicKey,
                    );
                    const feeRecipientAfter = await getUsdcAtaBalance(
                        connection,
                        solanaFeeRecipient.publicKey,
                    );
                    assert.isTrue(recipientAfter - recipientBefore >= localVariables["amountOut"]);
                    assert.equal(
                        feeRecipientAfter,
                        feeRecipientBefore + localVariables["relayingFee"],
                    );
                });
            });
        });
    });

    async function modifyWsolToUsdcSwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): Promise<jupiterV6.ModifiedSharedAccountsRoute> {
        const response = JSON.parse(
            fs.readFileSync(
                `${__dirname}/../../solana/ts/tests/jupiterV6SwapResponses/phoenix_v1_wsol_to_usdc.json`,
                {
                    encoding: "utf-8",
                },
            ),
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
            fs.readFileSync(
                `${__dirname}/../../solana/ts/tests/jupiterV6SwapResponses/phoenix_v1_usdc_to_wsol.json`,
                {
                    encoding: "utf-8",
                },
            ),
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
            fs.readFileSync(
                `${__dirname}/../../solana/ts/tests/jupiterV6SwapResponses/whirlpool_usdt_to_usdc.json`,
                {
                    encoding: "utf-8",
                },
            ),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(
            connection,
            response,
            tokenOwner,
            opts,
        );
    }

    async function modifyUsdcToUsdtSwapResponseForTest(
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ): Promise<jupiterV6.ModifiedSharedAccountsRoute> {
        const response = JSON.parse(
            fs.readFileSync(
                `${__dirname}/../../solana/ts/tests/jupiterV6SwapResponses/whirlpool_usdc_to_usdt.json`,
                {
                    encoding: "utf-8",
                },
            ),
        );

        return jupiterV6.modifySharedAccountsRouteInstruction(
            connection,
            response,
            tokenOwner,
            opts,
        );
    }
});
