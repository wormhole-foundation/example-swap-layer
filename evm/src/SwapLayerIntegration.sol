// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "./ISwapLayer.sol";
import "./SwapLayerIntegrationBase.sol";

abstract contract SwapLayerIntegration is SwapLayerIntegrationBase {
  ISwapLayer private immutable _swapLayer_;
  address    private immutable _wormhole;
  address    private immutable _usdc;
  address    private immutable _wrappedNative;

  constructor(address swapLayer) {
    _swapLayer_    = ISwapLayer(payable(swapLayer));
    _wormhole      = SwapLayerIntegrationBase._swapLayerWormhole();
    _usdc          = SwapLayerIntegrationBase._swapLayerUsdc();
    _wrappedNative = SwapLayerIntegrationBase._swapLayerWrappedNative();
  }

  function _swapLayer() override internal view returns (ISwapLayer) {
    return _swapLayer_;
  }

  function _swapLayerWormhole() override internal view returns (address) {
    return _wormhole;
  }

  function _swapLayerUsdc() override internal view returns (address) {
    return _usdc;
  }

  function _swapLayerWrappedNative() override internal view returns (address) {
    return _wrappedNative;
  }
}
