// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "forge-std/Test.sol";

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IWormhole } from "wormhole/IWormhole.sol";
import { fromUniversalAddress } from "wormhole/Utils.sol";
import { SigningWormholeSimulator } from "wormhole/WormholeSimulator.sol";
import { CircleSimulator } from "cctp/CircleSimulator.sol";
import { ITokenMessenger } from "cctp/ITokenMessenger.sol";
import { Proxy } from "proxy/Proxy.sol";
import { IPermit2 } from "permit2/IPermit2.sol";
import { ISwapRouter } from "uniswap/ISwapRouter.sol";

import { ITokenRouter } from "liquidity-layer/ITokenRouter.sol";
import { FastTransferParameters } from "liquidity-layer/ITokenRouterTypes.sol";
import { TokenRouterImplementation }
  from "./liquidity-layer/TokenRouter/TokenRouterImplementation.sol";

import { SwapLayer } from "swap-layer/SwapLayer.sol";
import { FeeParams, FeeParamsLib } from "swap-layer/assets/SwapLayerRelayingFees.sol";
import { Percentage, PercentageLib } from "swap-layer/assets/Percentage.sol";
import { GasPrice, GasPriceLib } from "swap-layer/assets/GasPrice.sol";
import { GasDropoff, GasDropoffLib } from "swap-layer/assets/GasDropoff.sol";

using PercentageLib for Percentage;
using GasPriceLib for GasPrice;
using GasDropoffLib for GasDropoff;

contract SwapLayerTestBase is Test {
  using FeeParamsLib for FeeParams;

  bytes32 constant FOREIGN_LIQUIDITY_LAYER        = bytes32(uint256(uint160(address(1))));
  bytes32 constant FOREIGN_SWAP_LAYER             = bytes32(uint256(uint160(address(2))));
  bytes32 constant MATCHING_ENGINE_ADDRESS        = bytes32(uint256(uint160(address(3))));
  uint16  constant MATCHING_ENGINE_CHAIN          = 0xffff;
  uint32  constant MATCHING_ENGINE_DOMAIN         = 0xffffffff;
  uint128 constant FAST_TRANSFER_MAX_AMOUNT       = 1e9;
  uint128 constant FAST_TRANSFER_BASE_FEE         = 1e6;
  uint128 constant FAST_TRANSFER_INIT_AUCTION_FEE = 1e6;

  IWormhole immutable wormhole;
  IERC20  immutable usdc;
  address immutable foreignUsdc;
  address immutable cctpTokenMessenger;
  uint16  immutable chainId;
  uint16  immutable foreignChainId;
  uint32  immutable foreignCircleDomain;

  address immutable signer;
  uint256 immutable signerSecret;
  address immutable llOwner;
  address immutable owner;
  address immutable assistant;
  address immutable feeRecipient;

  ITokenRouter liquidityLayer;
  SigningWormholeSimulator wormholeSimulator;
  CircleSimulator circleSimulator;

  SwapLayer swapLayer;

  constructor() {
    wormhole            = IWormhole(vm.envAddress("TEST_WORMHOLE_ADDRESS"));
    usdc                = IERC20(vm.envAddress("TEST_USDC_ADDRESS"));
    foreignUsdc         = vm.envAddress("TEST_FOREIGN_USDC_ADDRESS");
    cctpTokenMessenger  = vm.envAddress("TEST_CCTP_TOKEN_MESSENGER_ADDRESS");
    chainId             = wormhole.chainId();
    foreignChainId      = uint16(vm.envUint("TEST_FOREIGN_CHAIN_ID"));
    foreignCircleDomain = uint32(vm.envUint("TEST_FOREIGN_CIRCLE_DOMAIN"));

    (signer, signerSecret) = makeAddrAndKey("signer");
    llOwner                = makeAddr("llOwner");
    owner                  = makeAddr("owner");
    assistant              = makeAddr("assistant");
    feeRecipient           = makeAddr("feeRecipient");
  }

  function deployBase() public {
    address llAssistant = address(0);
    liquidityLayer = ITokenRouter(address(new ERC1967Proxy(
      address(new TokenRouterImplementation(
        address(usdc),
        address(wormhole),
        cctpTokenMessenger,
        MATCHING_ENGINE_CHAIN,
        MATCHING_ENGINE_ADDRESS,
        MATCHING_ENGINE_DOMAIN
      )),
      abi.encodeCall(TokenRouterImplementation.initialize, (llOwner, llAssistant))
    )));

    vm.startPrank(llOwner);
    liquidityLayer.setCctpAllowance(type(uint256).max);
    liquidityLayer.addRouterEndpoint(foreignChainId, FOREIGN_LIQUIDITY_LAYER, foreignCircleDomain);
    liquidityLayer.updateFastTransferParameters(
      FastTransferParameters({
        enabled: true,
        maxAmount: FAST_TRANSFER_MAX_AMOUNT,
        baseFee: FAST_TRANSFER_BASE_FEE,
        initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE
      })
    );
    vm.stopPrank();

    wormholeSimulator = new SigningWormholeSimulator(wormhole, signerSecret);
    circleSimulator = new CircleSimulator(
      signerSecret,
      address(ITokenMessenger(cctpTokenMessenger).localMessageTransmitter())
    );
    circleSimulator.setupCircleAttester();

    FeeParams feeParams;
    feeParams = feeParams.baseFee(1e6); //1 USD
    feeParams = feeParams.gasPrice(GasPriceLib.to(1e10)); //10 gwei
    feeParams = feeParams.gasPriceMargin(PercentageLib.to(25, 0)); //25 % volatility margin
    feeParams = feeParams.gasPriceTimestamp(uint32(block.timestamp));
    feeParams = feeParams.gasPriceUpdateThreshold(PercentageLib.to(10, 0));
    feeParams = feeParams.maxGasDropoff(GasDropoffLib.to(1 ether));
    feeParams = feeParams.gasDropoffMargin(PercentageLib.to(1, 0)); //1 % volatility margin
    feeParams = feeParams.gasTokenPrice(1e8); //100 usd per fictional gas token

    swapLayer = SwapLayer(payable(address(new Proxy(
      address(new SwapLayer(
        IPermit2(vm.envAddress("TEST_PERMIT2_ADDRESS")),
        ISwapRouter(vm.envAddress("TEST_UNISWAP_V3_ROUTER_ADDRESS")),
        liquidityLayer
      )),
      abi.encodePacked(
        owner,
        assistant,
        feeRecipient,
        foreignChainId,
        FOREIGN_SWAP_LAYER,
        feeParams
      )
    ))));
  }
}
