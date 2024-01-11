// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPermit2 } from "permit2/IPermit2.sol";
import { ISwapRouter } from "uniswap/ISwapRouter.sol";
import { ITokenRouter } from "liquidity-layer/ITokenRouter.sol";

import { BytesParsing } from "wormhole/WormholeBytesParsing.sol";

import "./assets/SwapLayerQuery.sol";
import "./assets/SwapLayerInitiate.sol";
import "./assets/SwapLayerRedeem.sol";

//Inheritance diagram: (SL = SwapLayer)
//SL -> SL-Query    -> SL-RelayingFees -> SL-Governance -> SL-Base
// \\-> SL-Initiate ---^                 /             \-> ProxyBase
//  \-> SL-Redeem   --------------------/

contract SwapLayer is SwapLayerQuery, SwapLayerInitiate, SwapLayerRedeem {
  using BytesParsing for bytes;

  //constructor of the logic contract setting immutables
  constructor(
    IPermit2 permit2,
    ISwapRouter uniV3Router,
    ITokenRouter liquidityLayer,
    uint32 majorDelay,
    uint32 minorDelay
  ) SwapLayerGovernance(majorDelay, minorDelay)
    SwapLayerBase(permit2, uniV3Router, liquidityLayer) {}

  function _proxyConstructor(bytes calldata data_) internal override {
    bytes memory data = data_;
    uint offset = 0;

    address owner;
    address admin;
    address assistant;
    address feeRecipient;
    bool    adminCanUpgradeContract;
    (owner,                   offset) = data.asAddressUnchecked(offset);
    (admin,                   offset) = data.asAddressUnchecked(offset);
    (assistant,               offset) = data.asAddressUnchecked(offset);
    (feeRecipient,            offset) = data.asAddressUnchecked(offset);
    (adminCanUpgradeContract, offset) = data.asBoolUnchecked(offset);

    _governanceConstruction(owner, admin, assistant, feeRecipient, adminCanUpgradeContract);

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
    _maxApprove(_usdc, address(_uniV3Router));
    _maxApprove(_weth, address(_uniV3Router));
  }

  //to support weth.withdraw
  receive() external payable {}
}
