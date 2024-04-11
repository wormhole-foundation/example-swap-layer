// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "wormhole-sdk/libraries/BytesParsing.sol";

import { SwapLayerGovernance } from "./SwapLayerGovernance.sol";

enum ImmutableType {
  Wormhole,
  Usdc,
  WrappedNative,
  Permit2,
  UniswapRouter,
  TraderJoeRouter,
  LiquidityLayer
}

enum QueryType {
  FeeParams,
  Peer,
  Immutable,
  AssistantIsEmpowered,
  Owner,
  PendingOwner,
  Assistant,
  FeeUpdater,
  FeeRecipient,
  Implementation
}

abstract contract SwapLayerQuery is SwapLayerGovernance {
  using BytesParsing for bytes;

  //selector: 64ee4476
  function batchQueries(bytes memory queries) external view returns (bytes memory) {
    //this is memory inefficient due to unnecessary copying but it shouldn't matter in practice
    bytes memory ret;
    uint offset = 0;
    while (offset < queries.length) {
      uint8 query_;
      (query_, offset) = queries.asUint8Unchecked(offset);
      QueryType query = QueryType(query_);
      if (query == QueryType.FeeParams || query == QueryType.Peer) {
        uint16 chainId;
        (chainId, offset) = queries.asUint16Unchecked(offset);
        ret = query == QueryType.FeeParams
          ? abi.encodePacked(ret, _getFeeParams(chainId))
          : abi.encodePacked(ret, _getPeer(chainId));
      }
      else if (query == QueryType.Immutable) {
        uint8 immutableType_;
        (immutableType_, offset) = queries.asUint8Unchecked(offset);
        ImmutableType immutableType = ImmutableType(immutableType_);
        address addr;
        if (immutableType == ImmutableType.Wormhole)
          addr = address(_wormhole);
        else if (immutableType == ImmutableType.Usdc)
          addr = address(_usdc);
        else if (immutableType == ImmutableType.WrappedNative)
          addr = address(_wnative);
        else if (immutableType == ImmutableType.Permit2)
          addr = address(_permit2);
        else if (immutableType == ImmutableType.UniswapRouter)
          addr = _uniswapRouter;
        else if (immutableType == ImmutableType.TraderJoeRouter)
          addr = _traderJoeRouter;
        else //must be ImmutableType.LiquidityLayer
          addr = address(_liquidityLayer);
        ret = abi.encodePacked(ret, addr);
      }
      else if (query == QueryType.AssistantIsEmpowered)
        ret = abi.encodePacked(ret, _getAssistantIsEmpowered());
      else { //query must be one of Admin, Owner, FeeRecipient, Implementation
        address addr;
        if (query == QueryType.Owner)
          addr = _getOwner();
        else if (query == QueryType.PendingOwner)
          addr = _getPendingOwner();
        else if (query == QueryType.Assistant)
          addr = _getAssistant();
        else if (query == QueryType.FeeUpdater)
          addr = _getFeeUpdater();
        else if (query == QueryType.FeeRecipient)
          addr = _getFeeRecipient();
        else //must be QueryType.Implementation
          addr = _getImplementation();
        ret = abi.encodePacked(ret, addr);
      }
    }
    queries.checkLength(offset);
    return ret;
  }
}
