// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import { BytesParsing } from "wormhole/WormholeBytesParsing.sol";

import "./SwapLayerRelayingFees.sol";

enum QueryType {
  FeeParams,
  Endpoint,
  Wormhole,
  Usdc,
  Weth,
  Permit2,
  UniswapV3Router,
  LiquidityLayer,
  Owner,
  PendingOwner,
  Assistant,
  FeeRecipient,
  Implementation
}

abstract contract SwapLayerBatchGet is SwapLayerRelayingFees {
  using BytesParsing for bytes;

  //selector: cb7bfd91
  function batchGet(bytes memory encodedQueries) external view returns (bytes memory) {
    //this is memory inefficient due to unnecessary copying but it shouldn't matter in practice
    bytes memory ret;
    uint offset = 0;
    while (offset < encodedQueries.length) {
      uint8 query_;
      (query_, offset) = encodedQueries.asUint8Unchecked(offset);
      QueryType query = QueryType(query_);
      if (query == QueryType.FeeParams) {
        uint16 chainId;
        (chainId, offset) = encodedQueries.asUint16Unchecked(offset);
        ret = abi.encodePacked(ret, _getFeeParams(chainId));
      }
      else if (query == QueryType.Endpoint) {
        uint16 chainId;
        (chainId, offset) = encodedQueries.asUint16Unchecked(offset);
        ret = abi.encodePacked(ret, _getEndpoint(chainId));
      }
      else if (query == QueryType.Wormhole)
        ret = abi.encodePacked(ret, _wormhole);
      else if (query == QueryType.Usdc)
        ret = abi.encodePacked(ret, _usdc);
      else if (query == QueryType.Weth)
        ret = abi.encodePacked(ret, _weth);
      else if (query == QueryType.Permit2)
        ret = abi.encodePacked(ret, _permit2);
      else if (query == QueryType.UniswapV3Router)
        ret = abi.encodePacked(ret, _uniV3Router);
      else if (query == QueryType.LiquidityLayer)
        ret = abi.encodePacked(ret, _liquidityLayer);
      else if (query == QueryType.Owner)
        ret = abi.encodePacked(ret, _getOwner());
      else if (query == QueryType.PendingOwner)
        ret = abi.encodePacked(ret, _getPendingOwner());
      else if (query == QueryType.Assistant)
        ret = abi.encodePacked(ret, _getAssistant());
      else if (query == QueryType.FeeRecipient)
        ret = abi.encodePacked(ret, _getFeeRecipient());
      else //must be QueryType.Implementation
        ret = abi.encodePacked(ret, _getImplementation());
    }
    encodedQueries.checkLength(offset);
    return ret;
  }
}
