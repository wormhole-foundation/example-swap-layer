// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { WormholeCctpMessages } from "wormhole-sdk/libraries/WormholeCctpMessages.sol";
import { toUniversalAddress } from "wormhole-sdk/Utils.sol";
import {
  FeeUpdate,
  RelayingDisabledForChain,
  GAS_OVERHEAD,
  DROPOFF_GAS_OVERHEAD,
  UNISWAP_GAS_OVERHEAD,
  UNISWAP_GAS_PER_SWAP,
  TRADERJOE_GAS_OVERHEAD,
  TRADERJOE_GAS_PER_SWAP
} from "swap-layer/assets/SwapLayerRelayingFees.sol";

import "swap-layer/SwapLayerIntegrationBase.sol";

import "./SLTBase.sol";

contract RelayingFeeTest is SLTBase, SwapLayerIntegrationBase {
  using BytesParsing for bytes;

  function _swapLayer() internal override view returns (ISwapLayer) {
    return ISwapLayer(payable(address(swapLayer)));
  }

  function _setUp1() internal override {
    //drop relaying fees to 0 across the board to start with
    vm.prank(assistant);
    swapLayer.batchFeeUpdates(abi.encodePacked(
      FOREIGN_CHAIN_ID, FeeUpdate.BaseFee,          uint32(0 * USDC),
      FOREIGN_CHAIN_ID, FeeUpdate.GasPrice,         GasPriceLib.to(0 gwei),
      FOREIGN_CHAIN_ID, FeeUpdate.GasPriceMargin,   PercentageLib.to(0, 0),
      FOREIGN_CHAIN_ID, FeeUpdate.GasTokenPrice,    uint64(0 * USDC),
      FOREIGN_CHAIN_ID, FeeUpdate.GasDropoffMargin, PercentageLib.to(0, 0),
      FOREIGN_CHAIN_ID, FeeUpdate.MaxGasDropoff,    GasDropoff.wrap(type(uint32).max),
      SOLANA_CHAIN_ID,  FeeUpdate.BaseFee,          uint32(0 * USDC),
      SOLANA_CHAIN_ID,  FeeUpdate.GasPrice,         GasPriceLib.to(0 gwei),
      SOLANA_CHAIN_ID,  FeeUpdate.GasPriceMargin,   PercentageLib.to(0, 0),
      SOLANA_CHAIN_ID,  FeeUpdate.GasTokenPrice,    uint64(0 * USDC),
      SOLANA_CHAIN_ID,  FeeUpdate.GasDropoffMargin, PercentageLib.to(0, 0),
      SOLANA_CHAIN_ID,  FeeUpdate.MaxGasDropoff,    GasDropoff.wrap(type(uint32).max)
    ));
  }

  function _getFeesNoSwap(uint gasDropoff) internal view returns (uint) {
    uint8 noSwap;
    return _swapLayerRelayingFee(FOREIGN_CHAIN_ID, gasDropoff, IoToken.Usdc, noSwap, noSwap);
  }

  function _checkApprox(uint relayingFee, uint expected) internal pure {
    if (expected < type(uint48).max)
      assertApproxEqAbs(relayingFee, uint48(expected), 4);
  }

  function testRelayingFeeOnlyBaseFee(uint32 baseFee) public {
    vm.assume(baseFee != type(uint32).max);

    vm.prank(assistant);
    swapLayer.batchFeeUpdates(abi.encodePacked(
      FOREIGN_CHAIN_ID, FeeUpdate.BaseFee, baseFee
    ));

    assertEq(_getFeesNoSwap(0), uint(baseFee));
  }

  function testRelayingFeeOnlyGasPriceWithMargin(
    uint32 gasPriceRaw,
    uint64 gasTokenPrice,
    uint rngSeed_
  ) public {
    uint[] memory rngSeed = new uint[](1);
    rngSeed[0] = rngSeed_;
    vm.prank(assistant);
    GasPrice gasPrice = GasPrice.wrap(gasPriceRaw);
    Percentage gasPriceMargin = fuzzPercentage(rngSeed);
    swapLayer.batchFeeUpdates(abi.encodePacked(
      FOREIGN_CHAIN_ID, FeeUpdate.GasPrice,       gasPrice,
      FOREIGN_CHAIN_ID, FeeUpdate.GasTokenPrice,  gasTokenPrice,
      FOREIGN_CHAIN_ID, FeeUpdate.GasPriceMargin, gasPriceMargin
    ));

    uint expected =
      gasPriceMargin.compoundUnchecked(GAS_OVERHEAD * gasPrice.from() * gasTokenPrice / 1 ether);
    _checkApprox(_getFeesNoSwap(0), expected);
  }

  function testRelayingFeeOnlyGasDropoffWithMargin(
    uint32 gasDropoffRaw,
    uint64 gasTokenPrice,
    uint rngSeed_
  ) public {
    uint[] memory rngSeed = new uint[](1);
    rngSeed[0] = rngSeed_;
    vm.prank(assistant);
    GasDropoff gasDropoff = GasDropoff.wrap(gasDropoffRaw);
    Percentage gasDropoffMargin = fuzzPercentage(rngSeed);
    swapLayer.batchFeeUpdates(abi.encodePacked(
      FOREIGN_CHAIN_ID, FeeUpdate.GasTokenPrice,    gasTokenPrice,
      FOREIGN_CHAIN_ID, FeeUpdate.GasDropoffMargin, gasDropoffMargin
    ));

    uint expected = gasDropoffMargin.compoundUnchecked(gasDropoff.from() * gasTokenPrice / 1 ether);
    _checkApprox(_getFeesNoSwap(gasDropoff.from()), expected);
  }

  function _fuzzSwapParams(uint[] memory rngSeed) internal pure returns (
    uint16 targetChain,
    uint8 swapType,
    uint8 swapCount
   ) {
    targetChain = xPercentOfTheTime(75, rngSeed) ? FOREIGN_CHAIN_ID : SOLANA_CHAIN_ID;
    swapType = targetChain == SOLANA_CHAIN_ID
      ? SWAP_TYPE_JUPITERV6
      : xPercentOfTheTime(50, rngSeed) ? SWAP_TYPE_UNISWAPV3 : SWAP_TYPE_TRADERJOE;
    swapCount = uint8(nextRn(rngSeed) % 3);
  }

  //this test feels pretty silly because it essentially is just an independently derived copy of
  //  the function in the contract... at least it's good to check that there are no regressions
  function testRelayingFeeFullFuzz(
    uint32 gasDropoffRaw,
    uint32 baseFee,
    uint32 gasPriceRaw,
    uint64 gasTokenPrice,
    uint   rngSeed_
  ) public {
    uint[] memory rngSeed = new uint[](1);
    rngSeed[0] = rngSeed_;
    vm.assume(baseFee != type(uint32).max);

    (uint16 targetChain, uint8 swapType, uint8 swapCount) = _fuzzSwapParams(rngSeed);
    GasPrice gasPrice           = GasPrice.wrap(gasPriceRaw);
    Percentage gasPriceMargin   = fuzzPercentage(rngSeed);
    Percentage gasDropoffMargin = fuzzPercentage(rngSeed);

    vm.prank(assistant);
    swapLayer.batchFeeUpdates(abi.encodePacked(
      targetChain, FeeUpdate.BaseFee,          baseFee,
      targetChain, FeeUpdate.GasPrice,         gasPrice,
      targetChain, FeeUpdate.GasTokenPrice,    gasTokenPrice,
      targetChain, FeeUpdate.GasPriceMargin,   gasPriceMargin,
      targetChain, FeeUpdate.GasDropoffMargin, gasDropoffMargin
    ));

    GasDropoff gasDropoff = GasDropoff.wrap(gasDropoffRaw);
    IoToken outputToken = nextRn(rngSeed) % 2 == 0 ? IoToken.Other : IoToken.Gas;

    uint relayingFee =
      _swapLayerRelayingFee(targetChain, gasDropoff.from(), outputToken, swapCount, swapType);

    uint expected = baseFee;
    if (targetChain == SOLANA_CHAIN_ID) {
      expected += gasDropoffMargin.compoundUnchecked(
        SOLANA_ATA_RENT_LAMPORTS * gasTokenPrice
      ) / LAMPORTS_PER_SOL;
    }
    else {
      (uint swapOverhead, uint gasPerSwap) =
        swapCount == 0
        ? (0, 0)
        : swapType == SWAP_TYPE_UNISWAPV3
        ? (UNISWAP_GAS_OVERHEAD,   UNISWAP_GAS_PER_SWAP)
        : (TRADERJOE_GAS_OVERHEAD, TRADERJOE_GAS_PER_SWAP);
      uint totalGas = GAS_OVERHEAD + swapOverhead + gasPerSwap * swapCount;
      if (gasDropoff.from() > 0)
        totalGas += DROPOFF_GAS_OVERHEAD;

      uint totalGasCost = gasPriceMargin.compoundUnchecked(
        totalGas * gasPrice.from() * gasTokenPrice / 1 ether
      );

      expected += totalGasCost;
    }

    expected += gasDropoffMargin.compoundUnchecked(gasDropoff.from() * gasTokenPrice / 1 ether);

    _checkApprox(relayingFee, expected);
  }
}
