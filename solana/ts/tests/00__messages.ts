import { SYSVAR_CLOCK_PUBKEY, SYSVAR_EPOCH_SCHEDULE_PUBKEY } from "@solana/web3.js";
import { encoding } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";
import { expect } from "chai";
import { SwapLayerMessage, decodeSwapLayerMessage, encodeSwapLayerMessage } from "../src/swapLayer";
import { USDC_MINT_ADDRESS } from "@wormhole-foundation/example-liquidity-layer-solana/testing";

describe("Swap Layer Messages", () => {
    it("USDC Direct", function () {
        const encoded = encoding.hex.decode(
            "010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d0000",
        );

        const decoded = decodeSwapLayerMessage(encoded);
        expect(decoded).to.eql({
            recipient: toUniversal("Ethereum", "0x6ca6d1e2d5347bfab1d91e883f1915560e09129d"),
            redeemMode: { mode: "Direct" },
            outputToken: { type: "Usdc" },
        } as SwapLayerMessage);
        expect(encodeSwapLayerMessage(decoded)).to.eql(encoded);
    });

    it("Ethereum Swap", function () {
        const encoded = encoding.hex.decode(
            "010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d00010000000000000000000000000000000000000000010001f4015991a2df15a8f6a256d3ec51e99254cd3fb576a90001f4",
        );

        const decoded = decodeSwapLayerMessage(encoded);
        expect(decoded).to.eql({
            recipient: toUniversal("Ethereum", "0x6ca6d1e2d5347bfab1d91e883f1915560e09129d"),
            redeemMode: { mode: "Direct" },
            outputToken: {
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
            },
        } as SwapLayerMessage);
        expect(encodeSwapLayerMessage(decoded)).to.eql(encoded);
    });

    it("USDC Relay", function () {
        const encoded = encoding.hex.decode(
            "010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d02000000000000000f424000",
        );

        const decoded = decodeSwapLayerMessage(encoded);
        expect(decoded).to.eql({
            recipient: toUniversal("Ethereum", "0x6ca6d1e2d5347bfab1d91e883f1915560e09129d"),
            redeemMode: { mode: "Relay", gasDropoff: 0, relayingFee: 1000000n },
            outputToken: { type: "Usdc" },
        } as SwapLayerMessage);
        expect(encodeSwapLayerMessage(decoded)).to.eql(encoded);
    });

    it("USDC Payload", function () {
        const encoded = encoding.hex.decode(
            "010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d0100000000000000000000000000000000000000000000000000000000000ba5ed0004deadbeef00",
        );

        const decoded = decodeSwapLayerMessage(encoded);
        expect(decoded).to.eql({
            recipient: toUniversal("Ethereum", "0x6ca6d1e2d5347bfab1d91e883f1915560e09129d"),
            redeemMode: {
                mode: "Payload",
                sender: toUniversal("Ethereum", "0x00000000000000000000000000000000000ba5ed"),
                buf: Buffer.from("deadbeef", "hex"),
            },
            outputToken: { type: "Usdc" },
        } as SwapLayerMessage);
        expect(encodeSwapLayerMessage(decoded)).to.eql(encoded);
    });

    it("Jupiter V6 Swap Direct Gas (No Dex)", function () {
        const encoded = encoding.hex.decode(
            "0106a7d51718c774c928566398691d5eb68b5eb8a39b4b6d5c73555b2100000000000100bc614e0000000000000000000000003b9ac9ff1000",
        );

        const decoded = decodeSwapLayerMessage(encoded);
        expect(decoded).to.eql({
            recipient: toUniversal("Solana", SYSVAR_CLOCK_PUBKEY.toBytes()),
            redeemMode: { mode: "Direct" },
            outputToken: {
                type: "Gas",
                swap: {
                    deadline: 12345678,
                    limitAmount: 999999999n,
                    type: {
                        id: "JupiterV6",
                        dexProgramId: { isSome: false },
                    },
                },
            },
        } as SwapLayerMessage);
        expect(encodeSwapLayerMessage(decoded)).to.eql(encoded);
    });

    it("Jupiter V6 Swap Direct Other (Some Dex)", function () {
        const encoded = encoding.hex.decode(
            "0106a7d51718c774c928566398691d5eb68b5eb8a39b4b6d5c73555b21000000000002c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d6100bc614e0000000000000000000000003b9ac9ff100106a7d51718dc3fee02d3e47f0100f8b054f7942e60591e3f508719a805000000",
        );

        const decoded = decodeSwapLayerMessage(encoded);
        expect(decoded).to.eql({
            recipient: toUniversal("Solana", SYSVAR_CLOCK_PUBKEY.toBytes()),
            redeemMode: { mode: "Direct" },
            outputToken: {
                type: "Other",
                address: toUniversal("Solana", USDC_MINT_ADDRESS.toBytes()),
                swap: {
                    deadline: 12345678,
                    limitAmount: 999999999n,
                    type: {
                        id: "JupiterV6",
                        dexProgramId: {
                            isSome: true,
                            address: toUniversal("Solana", SYSVAR_EPOCH_SCHEDULE_PUBKEY.toBytes()),
                        },
                    },
                },
            },
        } as SwapLayerMessage);
        expect(encodeSwapLayerMessage(decoded)).to.eql(encoded);
    });
});
