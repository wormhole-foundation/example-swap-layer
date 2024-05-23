import { OutputToken, RelayParams } from ".";

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

function calculateEvmSwapOverhead(outputToken: OutputToken): bigint {
    let overhead = 0n;
    let costPerSwap = 0n;
    let pathLen = 0n;

    if (outputToken.type === "Usdc") {
        return 0n;
    } else {
        if (outputToken.swap.type.id === "UniswapV3") {
            overhead = UNISWAP_GAS_OVERHEAD;
            costPerSwap = UNISWAP_GAS_PER_SWAP;
            pathLen = BigInt(outputToken.swap.type.path.length) + 1n;
        } else if (outputToken.swap.type.id === "TraderJoe") {
            overhead = TRADERJOE_GAS_OVERHEAD;
            costPerSwap = TRADERJOE_GAS_PER_SWAP;
            pathLen = BigInt(outputToken.swap.type.path.length) + 1n;
        } else {
            throw Error("Unsupported swap type");
        }
    }

    return overhead + pathLen * costPerSwap;
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
    outputToken: OutputToken,
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

        totalGas += calculateEvmSwapOverhead(outputToken);

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
