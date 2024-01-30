// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import { ERC1967Proxy } from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/token/ERC20/IERC20.sol";

import "wormhole-sdk/interfaces/IWormhole.sol";
import "wormhole-sdk/interfaces/token/IWETH.sol";
import "wormhole-sdk/interfaces/token/IUSDC.sol";
import "wormhole-sdk/proxy/Proxy.sol";
import { toUniversalAddress } from "wormhole-sdk/Utils.sol";
import "wormhole-sdk/testing/UsdcDealer.sol";
import "wormhole-sdk/testing/WormholeCctpSimulator.sol";

import "liquidity-layer/ITokenRouter.sol";
import { FastTransferParameters } from "liquidity-layer/ITokenRouterTypes.sol";
import { TokenRouterImplementation }
  from "./liquidity-layer/TokenRouter/TokenRouterImplementation.sol";

import { SwapLayer } from "swap-layer/SwapLayer.sol";
import "swap-layer/assets/SwapLayerRelayingFees.sol";
import "swap-layer/assets/Percentage.sol";
import "swap-layer/assets/GasPrice.sol";
import "swap-layer/assets/GasDropoff.sol";

contract SwapLayerTestBase is Test {
  using UsdcDealer for IUSDC;
  using { toUniversalAddress } for address;

  uint16  constant FOREIGN_CHAIN_ID               = 0xF00F;
  bytes32 constant FOREIGN_LIQUIDITY_LAYER        = bytes32(uint256(uint160(address(1))));
  bytes32 constant FOREIGN_SWAP_LAYER             = bytes32(uint256(uint160(address(2))));
  bytes32 constant MATCHING_ENGINE_ADDRESS        = bytes32(uint256(uint160(address(3))));
  uint16  constant MATCHING_ENGINE_CHAIN          = 0xFFFF;
  uint32  constant MATCHING_ENGINE_DOMAIN         = 0xFFFFFFFF;
  uint128 constant FAST_TRANSFER_MAX_AMOUNT       = 1e9;
  uint128 constant FAST_TRANSFER_BASE_FEE         = 1e6;
  uint128 constant FAST_TRANSFER_INIT_AUCTION_FEE = 1e6;
  uint32  constant MAJOR_DELAY                    = 7 days;
  uint32  constant MINOR_DELAY                    = 2 days;

  IWormhole immutable wormhole;
  IWETH     immutable wnative;
  IERC20    immutable usdc;
  address   immutable tokenMessenger;
  address   immutable traderJoeRouter;
  uint16    immutable chainId;

  address immutable llOwner;
  address immutable owner;
  address immutable admin;
  address immutable assistant;
  address immutable feeRecipient;

  WormholeCctpSimulator immutable wormholeCctpSimulator;

  ITokenRouter liquidityLayer;
  SwapLayer swapLayer;

  constructor() {
    wormhole        = IWormhole(vm.envAddress("TEST_WORMHOLE_ADDRESS"));
    wnative         = IWETH(vm.envAddress("TEST_WNATIVE_ADDRESS"));
    usdc            = IERC20(vm.envAddress("TEST_USDC_ADDRESS"));
    tokenMessenger  = vm.envAddress("TEST_CCTP_TOKEN_MESSENGER_ADDRESS");
    traderJoeRouter = vm.envAddress("TEST_TRADERJOE_ROUTER_ADDRESS");
    chainId         = wormhole.chainId();

    llOwner      = makeAddr("llOwner");
    owner        = makeAddr("owner");
    admin        = makeAddr("admin");
    assistant    = makeAddr("assistant");
    feeRecipient = makeAddr("feeRecipient");

    wormholeCctpSimulator = new WormholeCctpSimulator(
      wormhole,
      tokenMessenger,
      FOREIGN_CHAIN_ID,
      FOREIGN_LIQUIDITY_LAYER,
      address(0), //default mint recipient/destination caller - updated later
      address(usdc)
    );
  }

  function deployBase() public {
    address llAssistant = address(0);
    liquidityLayer = ITokenRouter(address(new ERC1967Proxy(
      address(new TokenRouterImplementation(
        address(usdc),
        address(wormhole),
        tokenMessenger,
        MATCHING_ENGINE_CHAIN,
        MATCHING_ENGINE_ADDRESS,
        MATCHING_ENGINE_DOMAIN
      )),
      abi.encodeCall(TokenRouterImplementation.initialize, (llOwner, llAssistant))
    )));

    wormholeCctpSimulator.setMintRecipient(address(liquidityLayer));
    wormholeCctpSimulator.setDestinationCaller(address(liquidityLayer));

    vm.startPrank(llOwner);
    liquidityLayer.setCctpAllowance(type(uint256).max);
    liquidityLayer.addRouterEndpoint(
      FOREIGN_CHAIN_ID,
      FOREIGN_LIQUIDITY_LAYER,
      FOREIGN_DOMAIN
    );
    liquidityLayer.updateFastTransferParameters(
      FastTransferParameters({
        enabled: true,
        maxAmount: FAST_TRANSFER_MAX_AMOUNT,
        baseFee: FAST_TRANSFER_BASE_FEE,
        initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE
      })
    );
    vm.stopPrank();

    FeeParams feeParams;
    feeParams = feeParams.baseFee(1e4); //1 cent
    feeParams = feeParams.gasPrice(GasPriceLib.to(1e10)); //10 gwei
    feeParams = feeParams.gasPriceMargin(PercentageLib.to(25, 0)); //25 % volatility margin
    feeParams = feeParams.gasPriceTimestamp(uint32(block.timestamp));
    feeParams = feeParams.gasPriceUpdateThreshold(PercentageLib.to(10, 0));
    feeParams = feeParams.maxGasDropoff(GasDropoffLib.to(1 ether));
    feeParams = feeParams.gasDropoffMargin(PercentageLib.to(1, 0)); //1 % volatility margin
    feeParams = feeParams.gasTokenPrice(1e5); //10 cent per fictional gas token

    swapLayer = SwapLayer(payable(address(new Proxy(
      address(new SwapLayer(
        MAJOR_DELAY,
        MINOR_DELAY,
        address(liquidityLayer),
        vm.envAddress("TEST_PERMIT2_ADDRESS"),
        address(wnative),
        vm.envAddress("TEST_UNISWAP_ROUTER_ADDRESS"),
        traderJoeRouter
      )),
      abi.encodePacked(
        owner,
        admin,
        assistant,
        feeRecipient,
        false, //adminCanUpgradeContract
        FOREIGN_CHAIN_ID,
        FOREIGN_SWAP_LAYER,
        feeParams
      )
    ))));
  }

  function _dealOverride(address token, address to, uint amount) internal {
    if (token == address(usdc))
      IUSDC(token).deal(to, amount);
    else
      deal(token, to, amount);
  }
}
