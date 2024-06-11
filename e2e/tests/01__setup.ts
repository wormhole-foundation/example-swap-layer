import { assert } from "chai";
import * as swapLayerSdk from "../../solana/ts/src/swapLayer";
import { Connection, SystemProgram } from "@solana/web3.js";
import {
    expectIxOk,
    PAYER_KEYPAIR,
    CHAIN_TO_DOMAIN,
    OWNER_KEYPAIR,
    LOCALHOST,
} from "@wormhole-foundation/example-liquidity-layer-solana/testing";
import { Chain, toChainId } from "@wormhole-foundation/sdk-base";
import { createAta } from "../../solana/ts/tests/helpers";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";
import {
    EVM_CONFIG,
    USDC_MINT_ADDRESS,
    REGISTERED_EVM_CHAINS,
    SOLANA_SWAP_LAYER_ID,
    overrideCircleAnvil,
    overrideWormholeAnvil,
    mintUsdcForTest,
} from "./helpers";

describe("Setup", () => {
    const connection = new Connection(LOCALHOST, "confirmed");

    const swapLayer = new swapLayerSdk.SwapLayerProgram(
        connection,
        SOLANA_SWAP_LAYER_ID,
        USDC_MINT_ADDRESS,
    );
    const tokenRouter = swapLayer.tokenRouterProgram();
    const matchingEngine = tokenRouter.matchingEngineProgram();

    const payer = PAYER_KEYPAIR;
    const owner = OWNER_KEYPAIR;

    describe("Matching Engine", function () {
        for (const chain of REGISTERED_EVM_CHAINS.slice(0, 1)) {
            it(`Update CCTP Endpoint (${chain})`, async function () {
                const cfg = EVM_CONFIG[chain];
                assert.isDefined(cfg);

                await updateMatchingEngineCctpEndpoint(
                    chain,
                    toUniversal(chain, cfg.tokenRouter).toUint8Array(),
                );
            });
        }

        for (const chain of REGISTERED_EVM_CHAINS.slice(1)) {
            it(`Add CCTP Endpoint (${chain})`, async function () {
                const cfg = EVM_CONFIG[chain];
                assert.isDefined(cfg);

                const endpoint = Array.from(toUniversal(chain, cfg.tokenRouter).toUint8Array());

                const ix = await matchingEngine.addCctpRouterEndpointIx(
                    {
                        ownerOrAssistant: owner.publicKey,
                        payer: payer.publicKey,
                    },
                    {
                        chain: toChainId(chain),
                        cctpDomain: cfg.cctpDomain,
                        address: endpoint,
                        mintRecipient: endpoint,
                    },
                );
                await expectIxOk(connection, [ix], [payer, owner]);
            });
        }
    });

    describe("Swap Layer", function () {
        before("Set Up Owner", async function () {
            await expectIxOk(
                connection,
                [
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: owner.publicKey,
                        lamports: 1000000000,
                    }),
                ],
                [payer],
            );
            await createAta(connection, payer, swapLayer.usdcMint, owner.publicKey);
        });

        it("Initialize", async function () {
            const ix = await swapLayer.initializeIx({
                owner: owner.publicKey,
                ownerAssistant: owner.publicKey,
                feeRecipient: owner.publicKey,
                feeUpdater: owner.publicKey,
            });

            await expectIxOk(connection, [ix], [payer, owner]);
        });

        for (const chain of REGISTERED_EVM_CHAINS) {
            it(`Add Peer (${chain})`, async function () {
                const cfg = EVM_CONFIG[chain];
                assert.isDefined(cfg);

                const ix = await swapLayer.addPeerIx(
                    {
                        ownerOrAssistant: owner.publicKey,
                        payer: payer.publicKey,
                    },
                    {
                        chain: toChainId(chain),
                        address: Array.from(toUniversal(chain, cfg.swapLayer).toUint8Array()),
                        relayParams: cfg.relayParams,
                    },
                );
                await expectIxOk(connection, [ix], [payer, owner]);
            });
        }
    });

    describe("Evm Network Setup", function () {
        for (const chain of REGISTERED_EVM_CHAINS) {
            it(`Modify Core Bridge (${chain})`, async () => {
                await overrideWormholeAnvil(chain, 0);
            });

            it(`Modify Circle Contracts (${chain})`, async () => {
                await overrideCircleAnvil(chain);
            });

            it(`Mint USDC (${chain})`, async () => {
                await mintUsdcForTest(chain, "69420000000000");
            });
        }
    });

    async function updateMatchingEngineCctpEndpoint(
        chain: Chain,
        address: Uint8Array | Buffer,
        mintRecipient?: Uint8Array | Buffer,
    ) {
        mintRecipient ??= address;

        const cctpDomain = CHAIN_TO_DOMAIN[chain];
        assert.isDefined(cctpDomain);

        const ix = await matchingEngine.updateCctpRouterEndpointIx(
            {
                owner: owner.publicKey,
            },
            {
                chain: toChainId(chain),
                cctpDomain,
                address: Array.from(address),
                mintRecipient: Array.from(mintRecipient),
            },
        );
        await expectIxOk(connection, [ix], [payer, owner]);
    }

    async function disableMatchingEngineEndpoint(chain: Chain) {
        const ix = await matchingEngine.disableRouterEndpointIx(
            {
                owner: owner.publicKey,
            },
            toChainId(chain),
        );
        await expectIxOk(connection, [ix], [payer, owner]);
    }
});
