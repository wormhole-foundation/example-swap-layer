// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "wormhole-sdk/libraries/BytesParsing.sol";

import { FeeParams } from "./FeeParams.sol";
import { GasDropoff } from "./GasDropoff.sol";
import { IoToken, parseIoToken } from "./Params.sol";
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

//sorted by expected frequency of on-chain queries
enum QueryType {
  FeeParams, //first for oracle queries
  RelayingFee,
  Peer,
  Immutable,
  Owner,
  PendingOwner,
  Assistant,
  FeeUpdater,
  FeeRecipient,
  Implementation
}

abstract contract SwapLayerQuery is SwapLayerGovernance {
  using BytesParsing for bytes;

  function batchQueries(bytes memory queries) external view returns (bytes memory) {
    //this is likely memory inefficient due to unnecessary copying (unless solc is smart enough to
    //  realize that it can use a sort of tailrecursion and hence can just append to ret)
    //in any case, it likely won't matter in practice
    bytes memory ret;
    uint offset = 0;
    while (offset < queries.length) {
      uint8 query_;
      (query_, offset) = queries.asUint8Unchecked(offset);
      QueryType query = QueryType(query_);
      if (query == QueryType.FeeParams || query == QueryType.Peer) {
        uint16 chainId;
        (chainId, offset) = queries.asUint16Unchecked(offset);
        ret = abi.encodePacked(ret,
          query == QueryType.FeeParams
          ? FeeParams.unwrap(_getFeeParams(chainId))
          : uint(_getPeer(chainId))
        );
      }
      else if (query == QueryType.RelayingFee) {
        uint16 chainId;
        uint32 gasDropoff;
        IoToken outputTokenType;
        uint swapCount;
        uint swapType;
        (chainId,         offset) = queries.asUint16Unchecked(offset);
        (gasDropoff,      offset) = queries.asUint32Unchecked(offset);
        (outputTokenType, offset) = parseIoToken(queries, offset);
        (swapCount,       offset) = queries.asUint8Unchecked(offset);
        (swapType,        offset) = queries.asUint8Unchecked(offset);
        ret = abi.encodePacked(ret,
          //unchecked cast, but if fee params are configured to allow a relaying fee of
          //  log(2^48) - 6 ~= 8 i.e. 100M usdc then...
          uint48(_calcRelayingFee(
            chainId,
            GasDropoff.wrap(gasDropoff),
            outputTokenType,
            swapCount,
            swapType
          ))
        );
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
        else if (immutableType == ImmutableType.LiquidityLayer)
          addr = address(_liquidityLayer);
        else
          _assertExhaustive();

        ret = abi.encodePacked(ret, addr);
      }
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
        else if (query == QueryType.Implementation)
          addr = _getImplementation();
        else
          _assertExhaustive();

        ret = abi.encodePacked(ret, addr);
      }
    }
    queries.checkLength(offset);
    return ret;
  }
}
