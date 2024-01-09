// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPermit2 } from "permit2/IPermit2.sol";
import { ISwapRouter } from "uniswap/ISwapRouter.sol";
import { ITokenRouter } from "liquidity-layer/ITokenRouter.sol";

import { BytesParsing } from "wormhole/WormholeBytesParsing.sol";

import "./assets/SwapLayerBase.sol";
import "./assets/SwapLayerGovernance.sol";
import "./assets/SwapLayerRelayingFees.sol";
import "./assets/SwapLayerBatchGet.sol";
import "./assets/SwapLayerInitiate.sol";
import "./assets/SwapLayerRedeem.sol";

//Inheritance diagram:
//SwapLayer -> SwapLayerBatchGet -> SwapLayerRelayingFees -> SwapLayerGovernance -> SwapLayerBase
//        \\-> SwapLayerInitiate ---^                        ^                  \-> ProxyBase
//         \-> SwapLayerRedeem   ---------------------------/

contract SwapLayer is SwapLayerBatchGet, SwapLayerInitiate, SwapLayerRedeem {
  using BytesParsing for bytes;

  //constructor of the logic contract setting immutables
  constructor(
    IPermit2 permit2,
    ISwapRouter uniswapV3Router,
    ITokenRouter liquidityLayer
  ) SwapLayerBase(permit2, uniswapV3Router, liquidityLayer) {}

  function _proxyConstructor(bytes calldata data_) internal override {
    bytes memory data = data_;
    uint offset = 0;

    address owner;
    address assistant;
    address feeRecipient;
    (owner,        offset) = data.asAddressUnchecked(offset);
    (assistant,    offset) = data.asAddressUnchecked(offset);
    (feeRecipient, offset) = data.asAddressUnchecked(offset);
    _governanceConstruction(owner, assistant, feeRecipient);

    while (offset < data.length) {
      uint16 chain;
      bytes32 endpoint;
      uint256 feeParams;
      (chain,     offset) = data.asUint16Unchecked(offset);
      (endpoint,  offset) = data.asBytes32Unchecked(offset);
      (feeParams, offset) = data.asUint256Unchecked(offset);
      _setEndpoint(chain, endpoint);
      _setFeeParams(chain, FeeParamsLib.checkedWrap(feeParams));
    }
    data.checkLength(offset);

    _maxApprove(_usdc, address(_liquidityLayer));
  }

  //to support weth.withdraw
  receive() external payable {}
}
