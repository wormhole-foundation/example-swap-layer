// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "forge-std/console2.sol";

import "wormhole-sdk/proxy/Proxy.sol";
import {SwapLayer} from "swap-layer/SwapLayer.sol";

import {ParseSwapLayerConfig} from "./utils/ParseSLConfig.sol";

contract DeploySwapLayerForTest is ParseSwapLayerConfig {
    function deploy(DeploymentConfig memory config) public {
        address swapLayer = address(
            new Proxy(
                address(
                    new SwapLayer(
                        config.liquidityLayer,
                        config.permit2,
                        config.weth,
                        config.universalRouter,
                        config.traderJoeRouter
                    )
                ),
                abi.encodePacked(msg.sender, config.assistant, config.feeUpdater, config.feeRecipient)
            )
        );

        console2.log("Swap layer proxy deployed at:", swapLayer);
        return;
    }

    function run() public {
        vm.startBroadcast();

        DeploymentConfig memory config =
            _parseAndValidateDeploymentConfig(uint16(vm.envUint("RELEASE_WORMHOLE_CHAIN_ID")));

        deploy(config);
        vm.stopBroadcast();
    }
}
