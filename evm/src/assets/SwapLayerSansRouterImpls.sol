// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "wormhole-sdk/libraries/BytesParsing.sol";

import "./SwapLayerQuery.sol";
import "./SwapLayerInitiate.sol";
import "./SwapLayerRedeem.sol";

//Inheritance diagram: (SL = SwapLayer)
//                  /-> SL-Query -> SL-Governance -\---> ProxyBase
//SL-SansRouterImpls--> SL-Redeem -/                >--> SL-RelayingFees -> SL-Base
//                  \-> SL-Initiate ---------------/

error InvalidPeer();

abstract contract SwapLayerSansRouterImpls is SwapLayerQuery, SwapLayerInitiate, SwapLayerRedeem {
  using BytesParsing for bytes;

  //constructor of the logic contract setting immutables
  constructor(
    address liquidityLayer,
    address permit2,
    address wnative,
    address uniswapRouter,
    address traderJoeRouter
  ) SwapLayerBase(liquidityLayer, permit2, wnative, uniswapRouter, traderJoeRouter) {}

  //constructor of the proxy contract setting storage variables
  function _proxyConstructor(bytes calldata args_) internal override {
    bytes memory args = args_;
    uint offset = 0;

    address owner;
    address admin;
    address assistant;
    address feeRecipient;
    bool    adminCanUpgradeContract;
    (owner,                   offset) = args.asAddressUnchecked(offset);
    (admin,                   offset) = args.asAddressUnchecked(offset);
    (assistant,               offset) = args.asAddressUnchecked(offset);
    (feeRecipient,            offset) = args.asAddressUnchecked(offset);
    (adminCanUpgradeContract, offset) = args.asBoolUnchecked(offset);

    _governanceConstruction(owner, admin, assistant, feeRecipient, adminCanUpgradeContract);

    while (offset < args.length) {
      uint16 chain;
      bytes32 peer;
      uint256 feeParams;
      (chain,     offset) = args.asUint16Unchecked(offset);
      (peer,      offset) = args.asBytes32Unchecked(offset);
      (feeParams, offset) = args.asUint256Unchecked(offset);
      if (peer == bytes32(0))
        revert InvalidPeer();

      _setPeer(chain, peer);
      _setFeeParams(chain, FeeParamsLib.checkedWrap(feeParams));
    }
    args.checkLength(offset);

    _maxApprove(_usdc, address(_liquidityLayer));
    _uniswapInitialApprove();
    _traderJoeInitialApprove();
  }

  //to support wnative.withdraw
  receive() external payable {}
}