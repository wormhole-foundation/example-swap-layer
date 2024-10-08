import { RelayParams } from "./state";
import { uint64ToBN } from "@wormhole-foundation/example-liquidity-layer-solana/common";

export const TEST_RELAY_PARAMS: RelayParams = {
    baseFee: 100000,
    nativeTokenPrice: uint64ToBN(1000000),
    maxGasDropoff: 500000,
    gasDropoffMargin: 10000,
    executionParams: {
        evm: {
            gasPrice: 100000,
            gasPriceMargin: 10000,
        },
    },
    swapTimeLimit: {
        fastLimit: 2,
        finalizedLimit: 2,
    },
};
