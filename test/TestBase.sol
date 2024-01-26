// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "forge-std/Test.sol";

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IWormhole } from "wormhole/interfaces/IWormhole.sol";
import { toUniversalAddress } from "wormhole/Utils.sol";
import { WormholeOverride } from "wormhole-local/WormholeOverride.sol";
import { WormholeCctpOverride, FOREIGN_DOMAIN } from "wormhole-local/WormholeCctpOverride.sol";
import { IUSDC } from "cctp/IUSDC.sol";
import { Proxy } from "proxy/Proxy.sol";
import { IPermit2 } from "permit2/IPermit2.sol";

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
  using WormholeOverride for IWormhole;
  using FeeParamsLib for FeeParams;
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
  IERC20    immutable usdc;
  address   immutable tokenMessenger;
  uint16    immutable chainId;

  address immutable signer;
  uint256 immutable signerSecret;
  address immutable llOwner;
  address immutable owner;
  address immutable admin;
  address immutable assistant;
  address immutable feeRecipient;

  WormholeCctpOverride immutable cctpOverride;

  ITokenRouter liquidityLayer;
  SwapLayer swapLayer;

  constructor() {
    wormhole       = IWormhole(vm.envAddress("TEST_WORMHOLE_ADDRESS"));
    usdc           = IERC20(vm.envAddress("TEST_USDC_ADDRESS"));
    tokenMessenger = vm.envAddress("TEST_CCTP_TOKEN_MESSENGER_ADDRESS");
    chainId        = wormhole.chainId();

    (signer, signerSecret) = makeAddrAndKey("signer");
    llOwner                = makeAddr("llOwner");
    owner                  = makeAddr("owner");
    admin                  = makeAddr("admin");
    assistant              = makeAddr("assistant");
    feeRecipient           = makeAddr("feeRecipient");

    wormhole.setUpOverride(signerSecret);
    cctpOverride = new WormholeCctpOverride(
      wormhole,
      tokenMessenger,
      FOREIGN_CHAIN_ID,
      FOREIGN_LIQUIDITY_LAYER,
      address(0), //update later
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

    cctpOverride.setMintRecipient(address(liquidityLayer));
    cctpOverride.setDestinationCaller(address(liquidityLayer));

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
        vm.envAddress("TEST_WETH_ADDRESS"),
        vm.envAddress("TEST_UNISWAP_UNIVERSAL_ROUTER_ADDRESS"),
        address(0)
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

  function _dealUsdc(address to, uint256 amount) internal {
    //taken from Wormhole circle integration repo, see:
    // https://github.com/wormhole-foundation/wormhole-circle-integration/blob/evm/optimize/evm/forge/tests/helpers/libraries/UsdcDeal.sol
    IUSDC usdc_ = IUSDC(address(usdc));
    vm.prank(usdc_.masterMinter());
    usdc_.configureMinter(address(this), amount);
    usdc_.mint(address(to), amount);

    //this most canonical way of using forge randomly stopped working:
    // deal(address(usdc), address(to), amount);

    //brittle workaround for dealing usdc (Ethereum mainnet only):
    //  uses binance 14 address which has the highest usdc balance
    //vm.prank(0x28C6c06298d514Db089934071355E5743bf21d60);
    //usdc.transfer(address(to), amount);
  }
}
