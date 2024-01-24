// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import { BytesParsing } from "wormhole/libraries/BytesParsing.sol";

import { SwapLayerGovernance } from "./SwapLayerGovernance.sol";

enum SubQueryType {
  Current,
  Proposed,
  UnlockTime
}

enum ImmutableType {
  Wormhole,
  Usdc,
  Weth,
  Permit2,
  UniswapUniversalRouter,
  LiquidityLayer,
  MajorDelay,
  MinorDelay
}

enum QueryType {
  FeeParams,
  Endpoint, //has subquery type
  Immutable,
  AdminCanUpgradeContract,
  Assistant,
  Owner, //has subquery type
  Admin, //has subquery type
  FeeRecipient, //has subquery type
  Implementation //has subquery type
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
      if (query == QueryType.FeeParams) {
        uint16 chainId;
        (chainId, offset) = queries.asUint16Unchecked(offset);
        ret = abi.encodePacked(ret, _getFeeParams(chainId));
      }
      else if (query == QueryType.Endpoint) {
        uint8 subQueryType_;
        (subQueryType_, offset) = queries.asUint8Unchecked(offset);
        SubQueryType subQueryType = SubQueryType(subQueryType_);
        uint16 chainId;
        (chainId, offset) = queries.asUint16Unchecked(offset);
        if (subQueryType == SubQueryType.UnlockTime)
          ret = abi.encodePacked(ret, _getProposedEndpointUnlockTime(chainId));
        else
          ret = abi.encodePacked(ret,
            subQueryType == SubQueryType.Current
              ? _getEndpoint(chainId)
              : _getProposedEndpoint(chainId)
            );
      }
      else if (query == QueryType.Immutable) {
        uint8 immutableType_;
        (immutableType_, offset) = queries.asUint8Unchecked(offset);
        ImmutableType immutableType = ImmutableType(immutableType_);

        if (immutableType == ImmutableType.MajorDelay ||
            immutableType == ImmutableType.MinorDelay) {
          ret = abi.encodePacked(ret,
            immutableType == ImmutableType.MajorDelay
              ? _majorDelay
              : _minorDelay
          );
        }
        else {
          address addr;
          if (immutableType == ImmutableType.Wormhole)
            addr = address(_wormhole);
          else if (immutableType == ImmutableType.Usdc)
            addr = address(_usdc);
          else if (immutableType == ImmutableType.Weth)
            addr = address(_weth);
          else if (immutableType == ImmutableType.Permit2)
            addr = address(_permit2);
          else if (immutableType == ImmutableType.UniswapUniversalRouter)
            addr = address(_universalRouter);
          else //must be ImmutableType.LiquidityLayer
            addr = address(_liquidityLayer);
          ret = abi.encodePacked(ret, addr);
        }
      }
      else if (query == QueryType.Assistant)
        ret = abi.encodePacked(ret, _getAssistant());
      else if (query == QueryType.AdminCanUpgradeContract)
        ret = abi.encodePacked(ret, _getAdminCanUpgradeContract());
      else { //query must be one of Admin, Owner, FeeRecipient, Implementation
        uint8 subQueryType_;
        (subQueryType_, offset) = queries.asUint8Unchecked(offset);
        SubQueryType subQueryType = SubQueryType(subQueryType_);

        if (subQueryType == SubQueryType.UnlockTime) {
          uint32 unlockTime;
          if (query == QueryType.Admin)
            unlockTime = _getProposedAdminUnlockTime();
          else if (query == QueryType.Owner)
            unlockTime = _getProposedOwnerUnlockTime();
          else if (query == QueryType.FeeRecipient)
            unlockTime = _getProposedFeeRecipientUnlockTime();
          else //must be QueryType.Implementation
            unlockTime = _getProposedImplementationUnlockTime();
          ret = abi.encodePacked(ret, unlockTime);
        }
        else {
          address addr;
          if (query == QueryType.Admin)
            addr = subQueryType == SubQueryType.Current
              ? _getAdmin()
              : _getProposedAdmin();
          else if (query == QueryType.Owner)
            addr = subQueryType == SubQueryType.Current
              ? _getOwner()
              : _getProposedOwner();
          else if (query == QueryType.FeeRecipient)
            addr = subQueryType == SubQueryType.Current
              ? _getFeeRecipient()
              : _getProposedFeeRecipient();
          else //must be QueryType.Implementation
            addr = subQueryType == SubQueryType.Current
              ? _getImplementation()
              : _getProposedImplementation();
          ret = abi.encodePacked(ret, addr);
        }
      }
    }
    queries.checkLength(offset);
    return ret;
  }
}
