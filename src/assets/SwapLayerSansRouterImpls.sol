// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import { BytesParsing } from "wormhole/libraries/BytesParsing.sol";

import "./SwapLayerQuery.sol";
import "./SwapLayerInitiate.sol";
import "./SwapLayerRedeem.sol";

//Inheritance diagram: (SL = SwapLayer)
//                  /-> SL-Query -> SL-Governance -\---> ProxyBase
//SL-SansRouterImpls--> SL-Redeem -/                >--> SL-RelayingFees -> SL-Base
//                  \-> SL-Initiate ---------------/

error InvalidEndpoint();

abstract contract SwapLayerSansRouterImpls is SwapLayerQuery, SwapLayerInitiate, SwapLayerRedeem {
  using BytesParsing for bytes;

  //constructor of the logic contract setting immutables
  constructor(
    uint32 majorDelay,
    uint32 minorDelay,
    address liquidityLayer,
    address permit2,
    address weth,
    address uniswapRouter,
    address traderJoeRouter
  ) SwapLayerGovernance(majorDelay, minorDelay)
    SwapLayerBase(liquidityLayer, permit2, weth, uniswapRouter, traderJoeRouter) {}

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
      bytes32 endpoint;
      uint256 feeParams;
      (chain,     offset) = args.asUint16Unchecked(offset);
      (endpoint,  offset) = args.asBytes32Unchecked(offset);
      (feeParams, offset) = args.asUint256Unchecked(offset);
      if (endpoint == bytes32(0))
        revert InvalidEndpoint();

      _updateEndpoint(chain, bytes32(0), endpoint, FeeParamsLib.checkedWrap(feeParams));
    }
    args.checkLength(offset);

    _maxApprove(_usdc, address(_liquidityLayer));
    _uniswapInitialApprove();
    _traderJoeInitialApprove();
  }

  //to support weth.withdraw
  receive() external payable {}
}
