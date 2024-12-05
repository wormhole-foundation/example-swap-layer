// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "forge-std/console2.sol";

import "wormhole-sdk/proxy/Proxy.sol";
import {SwapLayer} from "swap-layer/SwapLayer.sol";

import {ParseSwapLayerConfig} from "./utils/ParseSLConfig.sol";

import "swap-layer/assets/SwapLayerRelayingFees.sol";
import "swap-layer/assets/SwapLayerGovernance.sol";

contract ConfigureSwapLayerForTest is ParseSwapLayerConfig {
    function createPeerRegistrationCommand(SLRegistration memory config) internal pure returns (bytes memory) {
        FeeParams feeParams;
        feeParams = feeParams.baseFee(config.baseFee);
        feeParams = feeParams.gasPrice(GasPriceLib.to(config.gasPrice));
        feeParams = feeParams.gasPriceMargin(PercentageLib.to(config.gasPriceMargin, 0));
        feeParams = feeParams.maxGasDropoff(GasDropoffLib.to(config.maxGasDropoff));
        feeParams = feeParams.gasDropoffMargin(PercentageLib.to(config.gasDropoffMargin, 0));
        feeParams = feeParams.gasTokenPrice(config.gasTokenPrice);

        return abi.encodePacked(GovernanceCommand.UpdatePeer, config.chainId, config.swapLayer, feeParams);
    }

    function run() public {
        vm.startBroadcast();

        // Wormhole chain ID that we are configuring.
        uint16 thisChainId = uint16(vm.envUint("RELEASE_WORMHOLE_CHAIN_ID"));

        (SLRegistration[] memory config, SwapLayer swapLayer) = _parseRegistrationConfig(thisChainId);

        bytes memory governanceCommands;
        for (uint256 i = 0; i < config.length; i++) {
            // Ignore our own chain ID.
            if (config[i].chainId == thisChainId) {
                continue;
            }

            governanceCommands = abi.encodePacked(governanceCommands, createPeerRegistrationCommand(config[i]));
        }

        // Batch the governance commands now.
        swapLayer.batchGovernanceCommands(governanceCommands);

        console2.log("Successfully configured swap layer for chain ID:", thisChainId);

        vm.stopBroadcast();
    }
}
