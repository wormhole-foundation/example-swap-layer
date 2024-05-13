import { RelayParams } from ".";

// Gas overheads for EVM.
const EVM_GAS_OVERHEAD = 100_000n;
const DROPOFF_GAS_OVERHEAD = 10_000n;
const UNISWAP_GAS_OVERHEAD = 100_000n;
const UNISWAP_GAS_PER_SWAP = 100_000n;
const TRADERJOE_GAS_OVERHEAD = 100_000n;
const TRADERJOE_GAS_PER_SWAP = 100_000n;
const ONE_ETHER = 1_000_000_000_000_000_000n;

// Solana specific constants.
const ONE_SOL = 1_000_000_000n;
const GAS_PRICE_SCALAR = 1_000_000n;
const GAS_DROPOFF_SCALAR = 1_000n;

export const U32_MAX = 4294967295;
const MAX_BPS = 1_000_000n;

// TODO: Need to implement serde for the following types. For now, we will use a dummy
// type to represent the swap type.
export type DestinationSwapType = {
    none?: {};
    uniswapV3?: {};
    traderJoe?: {};
    jupiterV6?: {};
};

export function denormalizeGasDropOff(gasDropOff: number): bigint {
    return BigInt(gasDropOff) * GAS_DROPOFF_SCALAR;
}

export function denormalizeGasPrice(gasPrice: number): bigint {
    return BigInt(gasPrice) * GAS_PRICE_SCALAR;
}

function compound(percentage: number, base: bigint): bigint {
    if (percentage == 0) {
        return base;
    } else {
        return base + (base * BigInt(percentage)) / MAX_BPS;
    }
}

function calculateEvmSwapOverhead(swapType: DestinationSwapType, swapCount: number): bigint {
    switch (swapType) {
        case { none: {} }:
            return 0n;
        case { uniswapV3: {} }:
            return UNISWAP_GAS_OVERHEAD + UNISWAP_GAS_PER_SWAP * BigInt(swapCount);
        case { traderJoe: {} }:
            return TRADERJOE_GAS_OVERHEAD + TRADERJOE_GAS_PER_SWAP * BigInt(swapCount);
        default:
            throw Error("Unsupported swap type");
    }
}

function calculateEvmGasCost(
    gasPrice: number,
    gasPriceMargin: number,
    totalGas: bigint,
    nativeTokenPrice: bigint,
): bigint {
    return compound(
        gasPriceMargin,
        (totalGas * denormalizeGasPrice(gasPrice) * nativeTokenPrice) / ONE_ETHER,
    );
}

function calculateGasDropoffCost(
    denormGasDropoff: bigint,
    gasDropoffMargin: number,
    nativeTokenPrice: bigint,
): bigint {
    return compound(gasDropoffMargin, (denormGasDropoff * nativeTokenPrice) / ONE_SOL);
}

export function calculateRelayerFee(
    relayParams: RelayParams,
    denormGasDropOff: bigint,
    swapType: DestinationSwapType,
    swapCount: number,
) {
    if (relayParams.baseFee === U32_MAX) {
        throw Error("Relaying Disabled");
    }

    let relayerFee = BigInt(relayParams.baseFee);

    if (denormGasDropOff > 0) {
        if (denormGasDropOff > denormalizeGasDropOff(relayParams.maxGasDropoff)) {
            throw Error("Gas Dropoff too high");
        }

        relayerFee += calculateGasDropoffCost(
            denormGasDropOff,
            relayParams.gasDropoffMargin,
            BigInt(relayParams.nativeTokenPrice.toString()),
        );
    }

    // Compute the relayer fee based on the cost of the relay in the
    // target execution environment's gas units (convert to USDC).
    if (relayParams.executionParams.evm) {
        let totalGas = EVM_GAS_OVERHEAD;

        if (denormGasDropOff > 0) {
            totalGas += DROPOFF_GAS_OVERHEAD;
        }

        if (swapCount > 0) {
            totalGas += calculateEvmSwapOverhead(swapType, swapCount);
        }

        relayerFee += calculateEvmGasCost(
            relayParams.executionParams.evm.gasPrice,
            relayParams.executionParams.evm.gasPriceMargin,
            totalGas,
            BigInt(relayParams.nativeTokenPrice.toString()),
        );
    } else {
        throw Error("Unsupported execution environment");
    }

    return relayerFee;
}
