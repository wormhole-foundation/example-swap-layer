// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "wormhole-sdk/libraries/BytesParsing.sol";

import "./SwapLayerQuery.sol";
import "./SwapLayerInitiate.sol";
import "./SwapLayerRedeem.sol";

error InvalidPeer();

//# Inheritance diagram
//
//SL = SwapLayer
//                    ┌─> SL-Query  ─┬─> SL-Governance ─┬─> ProxyBase
//SL-SansRouterImpls ─┼─> SL-Redeem ─┘                  └─┬─> SL-RelayingFees ─> SL-Base
//                    └─> SL-Initiate ────────────────────┘
//
//# General Remark
//
//This is a large contract and so a lot of care was taken to stay within the contract size limits.
//This means that the code is not as expressive and more "compressed" than it could be, meaning
//  that sometimes code is put in places or shared in a way that would normally be considered
//  bad/non-canonical but that would, if done cleanly, result in more bytecode being generated.
//E.g. two functions that are semantically somewhat different and should therefore be conceptually
//  distinct might be combined into a single function regardless to save space.
//Another example is that checks are used very sparsely/non-redundantly which can make it harder
//  to understand the constraints of a given code path.
//All of this is to say: This is a highly optimized contract that requires a lot care and context
//  when making changes. Hands off if you're a junior or not sure what you're doing.
//
//[ ] I'm too young to die
//[ ] Hey, not too rough
//[ ] Hurt me plenty
//[*] Ultra-Violence
//[ ] Nightmare!
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
    (owner,        offset) = args.asAddressUnchecked(offset);
    (admin,        offset) = args.asAddressUnchecked(offset);
    (assistant,    offset) = args.asAddressUnchecked(offset);
    (feeRecipient, offset) = args.asAddressUnchecked(offset);

    _governanceConstruction(owner, admin, assistant, feeRecipient);

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
