// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { BytesParsing } from "wormhole/libraries/BytesParsing.sol";

import "./assets/SwapLayerQuery.sol";
import "./assets/SwapLayerInitiate.sol";
import "./assets/SwapLayerRedeem.sol";

//Inheritance diagram: (SL = SwapLayer)
//  /-> SL-Query -> SL-Governance -\---> ProxyBase
//SL--> SL-Redeem -/                >--> SL-RelayingFees -> SL-Base
//  \-> SL-Initiate ---------------/

error InvalidEndpoint();

contract SwapLayer is SwapLayerQuery, SwapLayerInitiate, SwapLayerRedeem {
  using BytesParsing for bytes;

  //constructor of the logic contract setting immutables
  constructor(
    address weth,
    address permit2,
    //address uniV3Router,
    address universalRouter,
    address liquidityLayer,
    uint32 majorDelay,
    uint32 minorDelay
  ) SwapLayerGovernance(majorDelay, minorDelay)
    SwapLayerBase(weth, permit2, universalRouter, liquidityLayer) {}

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
    //universalRouter always uses permit2 for transfers...
    _maxApprove(_usdc, address(_permit2));
    _maxApprove(IERC20(address(_weth)), address(_permit2));
    _permit2MaxApprove(address(_usdc));
    _permit2MaxApprove(address(_weth));
    // _maxApprove(_usdc, address(_universalRouter));
    // _maxApprove(IERC20(address(_weth)), address(_universalRouter));
  }

  //to support weth.withdraw
  receive() external payable {}
}
