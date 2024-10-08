// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import { ERC1967Proxy } from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/token/ERC20/IERC20.sol";

import "wormhole-sdk/interfaces/IWormhole.sol";
import { IWETH } from "wormhole-sdk/interfaces/token/IWETH.sol";
import "wormhole-sdk/proxy/Proxy.sol";
import { IUSDC, UsdcDealer } from "wormhole-sdk/testing/UsdcDealer.sol";
import "wormhole-sdk/testing/WormholeCctpSimulator.sol";

import { ITokenRouter } from "liquidity-layer/interfaces/ITokenRouter.sol";
import { FastTransferParameters, Endpoint } from "liquidity-layer/interfaces/ITokenRouterTypes.sol";
import { Implementation } from "liquidity-layer/shared/Implementation.sol";
import { TokenRouter } from "liquidity-layer/TokenRouter/TokenRouter.sol";

import { SwapLayer } from "swap-layer/SwapLayer.sol";
import "swap-layer/assets/SwapLayerRelayingFees.sol";
import "swap-layer/assets/Percentage.sol";
import "swap-layer/assets/GasPrice.sol";
import "swap-layer/assets/GasDropoff.sol";

function nextRn(uint[] memory rngSeed) pure returns (uint) {
  rngSeed[0] = uint(keccak256(abi.encode(rngSeed[0])));
  return rngSeed[0];
}

function xPercentOfTheTime(uint x, uint[] memory rngSeed) pure returns (bool) {
  return (nextRn(rngSeed) % 100) < x;
}

function fuzzPercentage(uint[] memory rngSeed) pure returns (Percentage) {
  uint fractionalDigits = uint8(nextRn(rngSeed) % 5); //at most 4 fractional digits
  uint mantissa         = uint16(nextRn(rngSeed) >> 8) % 1e4; //4 digit mantissa

  if (mantissa > 100 && fractionalDigits == 0)
    ++fractionalDigits;
  if (mantissa > 1000 && fractionalDigits < 2)
    ++fractionalDigits;

  return PercentageLib.to(mantissa, fractionalDigits);
}

contract SLTBase is Test {
  using UsdcDealer for IUSDC;

  uint16  constant FOREIGN_CHAIN_ID               = 0xF00F;
  bytes32 constant FOREIGN_LIQUIDITY_LAYER        = bytes32(uint256(uint160(address(1))));
  bytes32 constant FOREIGN_SWAP_LAYER             = bytes32(uint256(uint160(address(2))));
  bytes32 constant SOLANA_SWAP_LAYER              = bytes32(uint256(uint160(address(3))));
  bytes32 constant MATCHING_ENGINE_ADDRESS        = bytes32(uint256(uint160(address(4))));
  bytes32 constant MATCHING_ENGINE_MINT_RECIPIENT = bytes32(uint256(uint160(address(5))));
  uint16  constant MATCHING_ENGINE_CHAIN          = 0xFFFF;
  uint64  constant USDC                           = 1e6;
  uint64  constant FAST_TRANSFER_MAX_AMOUNT       = USDC * 1e5;
  uint64  constant FAST_TRANSFER_BASE_FEE         = USDC * 3/10;
  uint64  constant FAST_TRANSFER_INIT_AUCTION_FEE = USDC * 2/10;


  IWormhole immutable wormhole;
  IWETH     immutable wnative;
  IERC20    immutable usdc;
  address   immutable tokenMessenger;
  address   immutable traderJoeRouter;
  uint16    immutable chainId;

  address immutable llOwner;
  address immutable owner;
  address immutable assistant;
  address immutable feeUpdater;
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
    assistant    = makeAddr("assistant");
    feeUpdater   = makeAddr("feeUpdater");
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

  function _setUp1() internal virtual { }

  function setUp() public {
    vm.startPrank(llOwner);
    {
      liquidityLayer = ITokenRouter(address(new ERC1967Proxy(
        address(new TokenRouter(
          address(usdc),
          address(wormhole),
          tokenMessenger,
          MATCHING_ENGINE_CHAIN,
          MATCHING_ENGINE_ADDRESS,
          MATCHING_ENGINE_MINT_RECIPIENT,
          FOREIGN_DOMAIN
        )),
        abi.encodeCall(Implementation.initialize, abi.encodePacked(llOwner)) //ownerAssistant
      )));

      liquidityLayer.setCctpAllowance(type(uint256).max);

      liquidityLayer.addRouterEndpoint(
        FOREIGN_CHAIN_ID,
        Endpoint(FOREIGN_LIQUIDITY_LAYER, FOREIGN_LIQUIDITY_LAYER),
        FOREIGN_DOMAIN
      );

      liquidityLayer.addRouterEndpoint(
        SOLANA_CHAIN_ID,
        Endpoint(FOREIGN_LIQUIDITY_LAYER, FOREIGN_LIQUIDITY_LAYER),
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
    }
    vm.stopPrank();

    wormholeCctpSimulator.setMintRecipient(address(liquidityLayer));
    wormholeCctpSimulator.setDestinationCaller(address(liquidityLayer));

    FeeParams feeParams;
    feeParams = feeParams.baseFee(1e4); //1 cent
    feeParams = feeParams.gasPrice(GasPriceLib.to(1e10)); //10 gwei
    feeParams = feeParams.gasPriceMargin(PercentageLib.to(25, 0)); //25 % volatility margin
    feeParams = feeParams.maxGasDropoff(GasDropoffLib.to(1 ether)); //also means 1 SOL for Solana
    feeParams = feeParams.gasDropoffMargin(PercentageLib.to(1, 0)); //1 % volatility margin
    feeParams = feeParams.gasTokenPrice(1e5); //10 cent per fictional gas token

    swapLayer = SwapLayer(payable(address(new Proxy(
      address(new SwapLayer(
        address(liquidityLayer),
        vm.envAddress("TEST_PERMIT2_ADDRESS"),
        address(wnative),
        vm.envAddress("TEST_UNISWAP_ROUTER_ADDRESS"),
        traderJoeRouter
      )),
      abi.encodePacked(
        owner,
        assistant,
        feeUpdater,
        feeRecipient,
        SOLANA_CHAIN_ID,
        SOLANA_SWAP_LAYER,
        feeParams,
        FOREIGN_CHAIN_ID,
        FOREIGN_SWAP_LAYER,
        feeParams
      )
    ))));

    _setUp1();
  }

  function _dealOverride(address token, address to, uint amount) internal {
    if (token == address(usdc))
      IUSDC(token).deal(to, amount);
    else
      deal(token, to, amount);
  }
}
