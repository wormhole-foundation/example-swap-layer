// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import "wormhole-sdk/proxy/Proxy.sol";
import {SwapLayer} from "swap-layer/SwapLayer.sol";
import {Endpoint, FastTransferParameters} from "liquidity-layer/interfaces/ITokenRouterTypes.sol";
import {ITokenRouter} from "liquidity-layer/interfaces/ITokenRouter.sol";
import {TokenRouter} from "liquidity-layer/TokenRouter/TokenRouter.sol";
import "swap-layer/assets/SwapLayerRelayingFees.sol";

import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";

contract DeploySwapLayerForTest is Script {
    // Anvil pubkeys. Associated private keys:
    // - 0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d
    // - 0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1
    // - 0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c
    address assistant = 0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1;
    address feeUpdater = 0xFFcf8FDEE72ac11b5c542428B35EEF5769C409f0;
    address feeRecipient = 0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b;

    // Addresses needed to deploy the SwapLayer and TokenRouter contracts.
    address permit2Contract = vm.envAddress("RELEASE_PERMIT_2");
    address wnative = vm.envAddress("RELEASE_WETH");
    address uniswapRouterAddress = vm.envAddress("RELEASE_UNIVERSAL_ROUTER");
    address usdc = vm.envAddress("RELEASE_USDC");
    address wormhole = vm.envAddress("RELEASE_WORMHOLE");
    address cctpTokenMessenger = vm.envAddress("RELEASE_TOKEN_MESSENGER");
    address traderJoeRouterAddress = address(0);

    // Matching Engine.
    bytes32 matchingEngineAddress = vm.envBytes32("RELEASE_ME_ADDRESS");
    bytes32 matchingEngineMintRecipient = vm.envBytes32("RELEASE_ME_MINT_RECIPIENT");

    // EVM addresses for registrations.
    uint16 evmChain = uint16(vm.envUint("RELEASE_EVM_CHAIN"));
    uint32 evmDomain = uint32(vm.envUint("RELEASE_EVM_DOMAIN"));
    bytes32 evmTokenRouter = vm.envBytes32("RELEASE_EVM_TOKEN_ROUTER");
    bytes32 evmSwapLayer = vm.envBytes32("RELEASE_EVM_SWAP_LAYER");

    // SOL addresses for registrations.
    uint16 solChain = uint16(vm.envUint("RELEASE_SOL_CHAIN"));
    uint32 solDomain = uint32(vm.envUint("RELEASE_SOL_DOMAIN"));
    bytes32 solTokenRouter = vm.envBytes32("RELEASE_SOL_TOKEN_ROUTER");
    bytes32 solTokenRouterMintRecipient =
        vm.envBytes32("RELEASE_SOL_TOKEN_ROUTER_MINT_RECIPIENT");
    bytes32 solSwapLayer = vm.envBytes32("RELEASE_SOL_SWAP_LAYER");

    function configureTokenRouter(address router) internal {
        // Register the Evm and Solana Token Routers.
        ITokenRouter(router).addRouterEndpoint(
            evmChain,
            Endpoint(evmTokenRouter, evmTokenRouter),
            evmDomain
        );
        ITokenRouter(router).addRouterEndpoint(
            solChain,
            Endpoint(solTokenRouter, solTokenRouterMintRecipient),
            solDomain
        );

        // Set the fast transfer parameters.
        ITokenRouter(router).updateFastTransferParameters(
            FastTransferParameters({
                enabled: true,
                maxAmount: 50_000e6, // $50,000
                baseFee: 75e4, // $0.75
                initAuctionFee: 75e4 // $0.75
            })
        );

        ITokenRouter(router).setCctpAllowance(type(uint256).max);
    }

    function deployTokenRouter() public returns (address) {
        TokenRouter implementation = new TokenRouter(
            usdc,
            wormhole,
            cctpTokenMessenger,
            solChain,
            matchingEngineAddress,
            matchingEngineMintRecipient,
            solDomain
        );

        TokenRouter proxy =
            TokenRouter(address(new ERC1967Proxy(address(implementation), "")));

        proxy.initialize(abi.encodePacked(assistant));

        address tokenRouterAddress = address(proxy);
        console.log("Token router deployed at:", tokenRouterAddress);

        configureTokenRouter(tokenRouterAddress);

        return tokenRouterAddress;
    }

    function deploy(address tokenRouter) public {
        // Sending to and from Solana won't use these params, so we will use them for
        // Solana as a placeholder.
        FeeParams feeParams;
        feeParams = feeParams.baseFee(25e4); // $0.25
        feeParams = feeParams.gasPrice(GasPriceLib.to(25e10)); // 25 Gwei
        feeParams = feeParams.gasPriceMargin(PercentageLib.to(25, 0)); // 25% volatility margin
        feeParams = feeParams.maxGasDropoff(GasDropoffLib.to(1 ether)); // 1 SOL/ETH
        feeParams = feeParams.gasDropoffMargin(PercentageLib.to(1, 0)); // 1% volatility margin
        feeParams = feeParams.gasTokenPrice(1e8); // $100.00

        address swapLayer = address(
            new Proxy(
                address(
                    new SwapLayer(
                        tokenRouter,
                        permit2Contract,
                        wnative,
                        uniswapRouterAddress,
                        traderJoeRouterAddress
                    )
                ),
                abi.encodePacked(
                    msg.sender,
                    assistant,
                    feeUpdater,
                    feeRecipient,
                    solChain,
                    solSwapLayer,
                    feeParams,
                    evmChain,
                    evmSwapLayer,
                    feeParams
                )
            )
        );

        console.log("Swap layer deployed at:", swapLayer);
    }

    function run() public {
        vm.startBroadcast();
        deploy(deployTokenRouter());
        vm.stopBroadcast();
    }
}
