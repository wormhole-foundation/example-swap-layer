// SPDX-License-Identifier: Apache 2
pragma solidity >=0.8.8 <0.9.0;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {ISwapLayer} from "swap-layer/ISwapLayer.sol";

contract ParseSwapLayerConfig is Script {
    using stdJson for string;

    // NOTE: Forge expects any struct to be defined in alphabetical order if being used
    // to parse JSON.
    struct ChainConfig {
        uint16 chainId;
        uint32 circleDomain;
        address wormhole;
        address liquidityLayer;
        address universalRouter;
        address permit2;
        address usdc;
        address circleMessageTransmitter;
        address weth;
        address traderJoeRouter;
    }

    mapping(uint16 => bool) duplicateChainIds;

    function toUniversalAddress(
        address evmAddr
    ) internal pure returns (bytes32 converted) {
        assembly ("memory-safe") {
            converted := and(0xffffffffffffffffffffffffffffffffffffffff, evmAddr)
        }
    }

    function fromUniversalAddress(
        bytes32 universalAddr
    ) internal pure returns (address converted) {
        require(bytes12(universalAddr) == 0, "Address overflow");

        assembly ("memory-safe") {
            converted := universalAddr
        }
    }

    function _parseAndValidateConfigFile(
        uint16 wormholeChainId
    )
        internal
        returns (
            ChainConfig[] memory config
        )
    {
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/cfg/evm.deployment.json");
        string memory json = vm.readFile(path);
        bytes memory contracts = json.parseRaw(".contracts");

        // Decode the json into ChainConfig array.
        config = abi.decode(contracts, (ChainConfig[]));

        // Validate values and set the contract addresses for this chain.
        for (uint256 i = 0; i < config.length; i++) {
            require(config[i].chainId != 0, "Invalid chain ID");

            // Make sure we don't configure the same chain twice.
            require(!duplicateChainIds[config[i].chainId], "Duplicate chain ID");
            duplicateChainIds[config[i].chainId] = true;
        }

        require(duplicateChainIds[wormholeChainId], "Wormhole chain ID not found");
    }
}