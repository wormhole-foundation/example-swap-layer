// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "forge-std/console2.sol";

import "wormhole-sdk/proxy/Proxy.sol";
import "wormhole-sdk/libraries/BytesParsing.sol";
import {SwapLayer} from "swap-layer/SwapLayer.sol";

import {ParseSwapLayerConfig} from "./utils/ParseSLConfig.sol";

import "swap-layer/assets/SwapLayerRelayingFees.sol";
import "swap-layer/assets/SwapLayerGovernance.sol";
import "swap-layer/assets/SwapLayerQuery.sol";

contract ValidateSwapLayerForTest is ParseSwapLayerConfig {
    using BytesParsing for bytes;

    function validatePeers(uint16 wormholeChainId, SwapLayer swapLayer, SLRegistration[] memory registrations)
        internal
        view
    {
        // Loop through each registration and validate the peer.
        for (uint256 i = 0; i < registrations.length; i++) {
            SLRegistration memory registration = registrations[i];
            if (registration.chainId == wormholeChainId) {
                // Skip self registration.
                continue;
            }

            bytes memory getRes = swapLayer.batchQueries(abi.encodePacked(QueryType.Peer, registration.chainId));
            (bytes32 peer,) = getRes.asBytes32Unchecked(0);
            require(peer == registration.swapLayer, "Peer mismatch");
        }
    }

    function validateFeeParams(uint16 wormholeChainId, SwapLayer swapLayer, SLRegistration[] memory registrations)
        internal
        view
    {
        // Loop through each registration and validate the fee params.
        for (uint256 i = 0; i < registrations.length; i++) {
            SLRegistration memory registration = registrations[i];
            if (registration.chainId == wormholeChainId) {
                // Skip self registration.
                continue;
            }

            bytes memory getRes = swapLayer.batchQueries(abi.encodePacked(QueryType.FeeParams, registration.chainId));
            (uint256 queriedFeeParams,) = getRes.asUint256Unchecked(0);

            // Parse the fee params.
            FeeParams feeParams;
            feeParams = feeParams.baseFee(registration.baseFee);
            feeParams = feeParams.gasPrice(GasPriceLib.to(registration.gasPrice));
            feeParams = feeParams.gasPriceMargin(PercentageLib.to(registration.gasPriceMargin, 0));
            feeParams = feeParams.maxGasDropoff(GasDropoffLib.to(registration.maxGasDropoff));
            feeParams = feeParams.gasDropoffMargin(PercentageLib.to(registration.gasDropoffMargin, 0));
            feeParams = feeParams.gasTokenPrice(registration.gasTokenPrice);

            require(FeeParams.unwrap(feeParams) == queriedFeeParams, "Fee params mismatch");
        }
    }

    function validateDeploymentAndConfiguration(
        uint16 wormholeChainId,
        SwapLayer swapLayer,
        DeploymentConfig memory deployConfig,
        SLRegistration[] memory registrations
    ) internal view {
        bytes memory getRes = swapLayer.batchQueries(
            abi.encodePacked(
                QueryType.Owner,
                QueryType.PendingOwner,
                QueryType.FeeRecipient,
                QueryType.FeeUpdater,
                QueryType.Assistant
            )
        );
        (address owner,) = getRes.asAddressUnchecked(0);
        (address pendingOwner,) = getRes.asAddressUnchecked(20);
        (address feeRecipient,) = getRes.asAddressUnchecked(40);
        (address feeUpdater,) = getRes.asAddressUnchecked(60);
        (address assistant,) = getRes.asAddressUnchecked(80);

        require(owner == msg.sender, "Owner mismatch");
        require(pendingOwner == address(0), "Pending owner mismatch");
        require(feeRecipient == deployConfig.feeRecipient, "Fee recipient mismatch");
        require(feeUpdater == deployConfig.feeUpdater, "Fee updater mismatch");
        require(assistant == deployConfig.assistant, "Assistant mismatch");

        validatePeers(wormholeChainId, swapLayer, registrations);

        validateFeeParams(wormholeChainId, swapLayer, registrations);

        getRes = swapLayer.batchQueries(
            abi.encodePacked(
                QueryType.Immutable,
                ImmutableType.Wormhole,
                QueryType.Immutable,
                ImmutableType.WrappedNative,
                QueryType.Immutable,
                ImmutableType.Permit2,
                QueryType.Immutable,
                ImmutableType.UniswapRouter,
                QueryType.Immutable,
                ImmutableType.TraderJoeRouter,
                QueryType.Immutable,
                ImmutableType.LiquidityLayer
            )
        );

        (address wormhole,) = getRes.asAddressUnchecked(0);
        (address weth,) = getRes.asAddressUnchecked(20);
        (address permit2,) = getRes.asAddressUnchecked(40);
        (address universalRouter,) = getRes.asAddressUnchecked(60);
        (address traderJoe,) = getRes.asAddressUnchecked(80);
        (address liquidity,) = getRes.asAddressUnchecked(100);

        require(wormhole == deployConfig.wormhole, "Wormhole mismatch");
        require(weth == deployConfig.weth, "WETH mismatch");
        require(permit2 == deployConfig.permit2, "Permit2 mismatch");
        require(universalRouter == deployConfig.universalRouter, "Uniswap router mismatch");
        require(traderJoe == deployConfig.traderJoeRouter, "Trader Joe router mismatch");
        require(liquidity == deployConfig.liquidityLayer, "Liquidity layer mismatch");
    }

    function run() public {
        vm.startBroadcast();

        // Wormhole chain ID that we are configuring.
        uint16 thisChainId = uint16(vm.envUint("RELEASE_WORMHOLE_CHAIN_ID"));

        DeploymentConfig memory deployConfig = _parseAndValidateDeploymentConfig(thisChainId);
        (SLRegistration[] memory registrations, SwapLayer swapLayer) = _parseRegistrationConfig(thisChainId);

        validateDeploymentAndConfiguration(thisChainId, swapLayer, deployConfig, registrations);

        vm.stopBroadcast();
    }
}
