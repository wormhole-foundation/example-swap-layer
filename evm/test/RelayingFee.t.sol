// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { WormholeCctpMessages } from "wormhole-sdk/libraries/WormholeCctpMessages.sol";
import { toUniversalAddress } from "wormhole-sdk/Utils.sol";
import { FeeUpdate, RelayingDisabledForChain } from "swap-layer/assets/SwapLayerRelayingFees.sol";

import "swap-layer/SwapLayerIntegrationBase.sol";

import "./SLTBase.sol";

contract RelayingFeeTest is SLTBase, SwapLayerIntegrationBase {
  using BytesParsing for bytes;

  function _swapLayer() internal override view returns (ISwapLayer) {
    return ISwapLayer(payable(address(swapLayer)));
  }

  function _setUp1() internal override {
    vm.prank(assistant);
    swapLayer.batchFeeUpdates(abi.encodePacked(
      FOREIGN_CHAIN_ID, FeeUpdate.BaseFee,          uint32(0 * USDC),
      FOREIGN_CHAIN_ID, FeeUpdate.GasPrice,         GasPriceLib.to(0 gwei),
      FOREIGN_CHAIN_ID, FeeUpdate.GasTokenPrice,    uint64(1 * USDC),
      FOREIGN_CHAIN_ID, FeeUpdate.GasDropoffMargin, PercentageLib.to(0, 0),
      FOREIGN_CHAIN_ID, FeeUpdate.GasPriceMargin,   PercentageLib.to(0, 0),
      FOREIGN_CHAIN_ID, FeeUpdate.MaxGasDropoff,    GasDropoffLib.to(100 * USDC)
    ));
  }

  function testRelayingFeeOnlyBaseFee(uint32 baseFeeUsdc) public {
    vm.assume(baseFeeUsdc != type(uint32).max);

    vm.prank(assistant);
    swapLayer.batchFeeUpdates(abi.encodePacked(
      FOREIGN_CHAIN_ID, FeeUpdate.BaseFee, baseFeeUsdc
    ));

    assertEq(_swapLayerRelayingFee(FOREIGN_CHAIN_ID, 0, IoToken.Usdc, 0, 1), uint48(baseFeeUsdc));
  }

  function testRelayingFeeOnlyGasPrice(uint32 gasPrice) public {
    vm.prank(assistant);
    swapLayer.batchFeeUpdates(abi.encodePacked(
      FOREIGN_CHAIN_ID, FeeUpdate.GasPrice, GasPrice.wrap(gasPrice)
    ));

    uint gasTokenPrice = _swapLayerFeeParams(FOREIGN_CHAIN_ID).gasTokenPrice();

    assertEq(
      _swapLayerRelayingFee(FOREIGN_CHAIN_ID, 0, IoToken.Usdc, 0, 1),
      uint48(GAS_OVERHEAD * gasPrice / gasTokenPrice));
  }
}
