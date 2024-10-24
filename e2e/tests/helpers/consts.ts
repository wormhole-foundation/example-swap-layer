import { PublicKey } from "@solana/web3.js";
import { parseSwapLayerEnvFile } from "./";
import { uint64ToBN } from "@wormhole-foundation/example-liquidity-layer-solana/common";

export const GUARDIAN_SET_INDEX = 0;

export const SOLANA_SWAP_LAYER_ID = "SwapLayer1111111111111111111111111111111111";
export const USDC_MINT_ADDRESS = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

export const EVM_PRIVATE_KEY = "0x395df67f0c2d2d9fe1ad08d1bc8b6627011959b79c53d7dd6a3536a33ab8a4fd";
export const RELAYER_PRIVATE_KEY =
    "0xe485d098507f54e7733a205420dfddbe58db035fa577fc294ebd14db90767a52";
export const GUARDIAN_PRIVATE_KEY =
    "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";
export const EVM_FEE_RECIPIENT = "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b";

export const ATTESTATION_TYPE_LL = 0;

export const ONE_ETHER = 1000000000000000000;
export const ONE_SOL = 1000000000;

// Avalanche Mainnet Fork
export const EVM_LOCALHOSTS = {
    Ethereum: "http://127.0.0.1:8545",
    Base: "http://127.0.0.1:8546",
};

// USDT tokens on Ethereum.
export const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

export const REGISTERED_EVM_CHAINS = ["Ethereum", "Base"] as const;
export const EVM_CONFIG = {
    Ethereum: {
        cctpDomain: 0,
        ...parseSwapLayerEnvFile(`${__dirname}/../../../evm/env/localnet/Ethereum.env`),
        relayParams: {
            baseFee: 250_000, // $0.25
            nativeTokenPrice: uint64ToBN(10_000_000), // $10
            maxGasDropoff: 1_000_000, // 1 SOL
            gasDropoffMargin: 10_000, // 1%
            executionParams: {
                evm: {
                    gasPrice: 25_000, // 25 Gwei
                    gasPriceMargin: 250_000, // 25%
                },
            },
            swapTimeLimit: { fastLimit: 30, finalizedLimit: 20 * 60 },
        },
    },
    Base: {
        cctpDomain: 6,
        ...parseSwapLayerEnvFile(`${__dirname}/../../../evm/env/localnet/Base.env`),
        relayParams: {
            baseFee: 250_000, // $0.25
            nativeTokenPrice: uint64ToBN(10_000_000), // $10
            maxGasDropoff: 1_000_000, // 1 SOL
            gasDropoffMargin: 10_000, // 1%
            executionParams: {
                evm: {
                    gasPrice: 25_000, // 25 Gwei
                    gasPriceMargin: 250_000, // 25%
                },
            },
            swapTimeLimit: { fastLimit: 30, finalizedLimit: 20 * 60 },
        },
    },
} as const;
