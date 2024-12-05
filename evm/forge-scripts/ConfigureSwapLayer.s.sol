// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "forge-std/console2.sol";

import "wormhole-sdk/proxy/Proxy.sol";
import {SwapLayer} from "swap-layer/SwapLayer.sol";

import {ParseSwapLayerConfig} from "./utils/ParseSLConfig.sol";

import "swap-layer/assets/SwapLayerRelayingFees.sol";
import "swap-layer/assets/SwapLayerGovernance.sol";

contract ConfigureSwapLayerForTest is ParseSwapLayerConfig {
    function createPeerRegistrationCommand(
        SLRegistration memory config
    ) internal returns (bytes memory) {
        FeeParams feeParams;
        feeParams = feeParams.baseFee(config.baseFee);
        feeParams = feeParams.gasPrice(GasPriceLib.to(config.gasPrice));
        feeParams = feeParams.gasPriceMargin(PercentageLib.to(config.gasPriceMargin, 0));
        feeParams = feeParams.maxGasDropoff(GasDropoffLib.to(config.maxGasDropoff));
        feeParams = feeParams.gasDropoffMargin(PercentageLib.to(config.gasDropoffMargin, 0));
        feeParams = feeParams.gasTokenPrice(config.gasTokenPrice);

        return abi.encodePacked(
            GovernanceCommand.UpdatePeer,
            config.chainId,
            config.addr,
            feeParams
        );
    }

    function run() public {
        vm.startBroadcast();

        (SLRegistration[] memory config, SwapLayer swapLayer) = _parseRegistrationConfig(
            uint16(vm.envUint("RELEASE_WORMHOLE_CHAIN_ID"))
        );

        bytes memory governanceCommands;
        // TODO: loop through config (ignoring the deployment chainID) and encode governance commands
        // using the createPeerRegistrationCommand function.

        // NOTE: See Governance.t.sol as a reference for how to batchGovernanceCommands.

        vm.stopBroadcast();
    }
}
