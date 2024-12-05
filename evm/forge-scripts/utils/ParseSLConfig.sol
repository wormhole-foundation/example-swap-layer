// SPDX-License-Identifier: Apache 2
pragma solidity >=0.8.8 <0.9.0;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {SwapLayer} from "swap-layer/SwapLayer.sol";

contract ParseSwapLayerConfig is Script {
    using stdJson for string;

    // NOTE: Forge expects any struct to be defined in alphabetical order if being used
    // to parse JSON.
    struct DeploymentConfig {
        address assistant;
        uint16 chainId;
        uint32 circleDomain;
        address circleMessageTransmitter;
        address feeRecipient;
        address feeUpdater;
        address liquidityLayer;
        address permit2;
        address traderJoeRouter;
        address universalRouter;
        address weth;
        address wormhole;
    }

    struct SLRegistration {
        uint32 baseFee;
        uint16 chainId;
        uint256 gasDropoffMargin;
        uint256 gasPrice;
        uint256 gasPriceMargin;
        uint64 gasTokenPrice;
        uint256 maxGasDropoff;
        bytes32 swapLayer;
    }

    mapping(uint16 => bool) duplicateChainIds;

    function fromUniversalAddress(bytes32 universalAddr) internal pure returns (address converted) {
        require(bytes12(universalAddr) == 0, "Address overflow");

        assembly ("memory-safe") {
            converted := universalAddr
        }
    }

    function _parseRegistrationConfig(uint16 wormholeChainId)
        internal
        returns (SLRegistration[] memory configs, SwapLayer swapLayer)
    {
        require(wormholeChainId > 0, "Invalid chain id");

        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/cfg/evm.deployment.json");
        string memory json = vm.readFile(path);
        bytes memory registrations = json.parseRaw(".registrations");

        configs = abi.decode(registrations, (SLRegistration[]));

        for (uint256 i = 0; i < configs.length; i++) {
            SLRegistration memory targetConfig = configs[i];

            require(!duplicateChainIds[targetConfig.chainId], "Duplicate chain ID");
            duplicateChainIds[targetConfig.chainId] = true;

            // Set the contract addresses for this chain.
            if (targetConfig.chainId == wormholeChainId) {
                swapLayer = SwapLayer(payable(fromUniversalAddress(targetConfig.swapLayer)));
            }
        }
    }

    function _parseAndValidateDeploymentConfig(uint16 wormholeChainId)
        internal
        view
        returns (DeploymentConfig memory)
    {
        require(wormholeChainId > 0, "Invalid chain id");

        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/cfg/evm.deployment.json");
        string memory json = vm.readFile(path);
        bytes memory deployments = json.parseRaw(".deployment");

        // Decode the json into DeploymentConfig array.
        DeploymentConfig[] memory config = abi.decode(deployments, (DeploymentConfig[]));

        // Validate values and find the specified chain's configuration.
        for (uint256 i = 0; i < config.length; i++) {
            DeploymentConfig memory targetConfig = config[i];

            if (targetConfig.chainId == wormholeChainId) {
                require(targetConfig.circleMessageTransmitter != address(0), "Invalid circleMessageTransmitter");
                require(targetConfig.liquidityLayer != address(0), "Invalid liquidityLayer");
                require(targetConfig.weth != address(0), "Invalid weth");
                require(targetConfig.wormhole != address(0), "Invalid wormhole");
                require(targetConfig.assistant != address(0), "Invalid assistant");
                require(targetConfig.feeRecipient != address(0), "Invalid feeRecipient");
                require(targetConfig.feeUpdater != address(0), "Invalid feeUpdater");

                return config[i];
            }
        }

        revert("Chain configuration not found");
    }
}
