// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "forge-std/console2.sol";

import "wormhole-sdk/proxy/Proxy.sol";
import {SwapLayer} from "swap-layer/SwapLayer.sol";

import {ParseSwapLayerConfig} from "./utils/ParseSLConfig.sol";

contract DeploySwapLayerForTest is ParseSwapLayerConfig {
    function deploy() public {
        // address swapLayer = address(
        //     new Proxy(
        //         address(
        //             new SwapLayer(
        //                 tokenRouter,
        //                 permit2Contract,
        //                 wnative,
        //                 uniswapRouterAddress,
        //                 traderJoeRouterAddress
        //             )
        //         ),
        //         abi.encodePacked(
        //             msg.sender,
        //             assistant,
        //             feeUpdater,
        //             feeRecipient,
        //             solChain,
        //             solSwapLayer,
        //             feeParams,
        //             evmChain,
        //             evmSwapLayer,
        //             feeParams
        //         )
        //     )
        // );

        //console.log("Swap layer deployed at:", swapLayer);
        return;
    }

    function run() public {
        vm.startBroadcast();

        ChainConfig[] memory config = _parseAndValidateConfigFile(6);

        console2.log("chain id: %s", config[0].chainId);
        console2.log("circleDomain: %s", config[0].circleDomain);
        console2.log("wormhole: %s", config[0].wormhole);
        console2.log("liquidityLayer: %s", config[0].liquidityLayer);
        console2.log("universalRouter: %s", config[0].universalRouter);
        console2.log("permit2: %s", config[0].permit2);
        console2.log("usdc: %s", config[0].usdc);
        console2.log("circleMessageTransmitter: %s", config[0].circleMessageTransmitter);
        console2.log("weth: %s", config[0].weth);
        console2.log("traderJoeRouter: %s", config[0].traderJoeRouter);

        //deploy();
        vm.stopBroadcast();
    }
}
