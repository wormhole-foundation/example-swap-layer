// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { BytesParsing } from "wormhole/WormholeBytesParsing.sol";
import { GasDropoff, GasDropoffLib } from "./GasDropoff.sol";

using BytesParsing for bytes;
using GasDropoffLib for GasDropoff;

uint constant MODE_SIZE = 1;
uint constant BOOL_SIZE = 1;
uint constant ADDRESS_SIZE = 20;
uint constant UNI_FEE_SIZE = 3;
uint constant SWAP_PARAM_AMOUNT_SIZE = 16;
uint constant SWAP_PARAM_DEADLINE_SIZE = 4;

uint constant UNI_PATH_ELEMENT_SIZE = ADDRESS_SIZE + UNI_FEE_SIZE;

uint constant RELAY_GAS_DROPOFF_SIZE     = 4;
uint constant RELAY_MAX_RELAYER_FEE_SIZE = 6;
uint constant RELAY_PARAM_SIZE = RELAY_GAS_DROPOFF_SIZE + RELAY_MAX_RELAYER_FEE_SIZE;

enum IoToken {
  Usdc,
  Gas,
  Erc20
}

enum RedeemMode {
  Direct,
  Payload,
  Relay
}

//swap layout:
//16 bytes  limitAmount
// 4 bytes  deadline (unix timestamp)
// 3 bytes  legFirstFee
// 1 byte   pathLength
// n bytes  swap path (n = pathLength * (20+3) (token address + uni fee))

function parseSwapParams(
  IERC20 inputToken,
  IERC20 outputToken,
  bytes memory params,
  uint offset
) pure returns (uint, uint256, bytes memory, uint) { unchecked {
  uint limitAmount;
  uint256 deadline;
  uint24 legFirstFee;
  uint pathLength; //total number of swaps = pathLength + 1
  (limitAmount,  offset) = params.asUint128Unchecked(offset);
  (deadline,     offset) = params.asUint32Unchecked(offset);
  (legFirstFee,  offset) = params.asUint24Unchecked(offset);
  (pathLength,   offset) = params.asUint8Unchecked(offset);
        
  uint sliceLen;
  sliceLen = pathLength * UNI_PATH_ELEMENT_SIZE;
  bytes memory partialPath;
  (partialPath, offset) = params.slice(offset, sliceLen);
  bytes memory path = abi.encodePacked(
    address(inputToken),
    legFirstFee,
    partialPath,
    address(outputToken)
  );

  return (limitAmount, deadline, path, offset);
}}

//total number of swaps = pathLength + 1
function parseSwapLength(
  bytes memory params,
  uint offset
) pure returns (uint /*pathLength*/, uint) { unchecked {
  offset += SWAP_PARAM_AMOUNT_SIZE + SWAP_PARAM_DEADLINE_SIZE + UNI_FEE_SIZE;
  return params.asUint8Unchecked(offset);
}}

function skipSwap(
  bytes memory params,
  uint offset
) pure returns (uint) { unchecked {
  uint pathLength; //total number of swaps = pathLength + 1
  (pathLength, offset) = parseSwapLength(params, offset);
  offset += pathLength * UNI_PATH_ELEMENT_SIZE;
  return offset;
}}

function parseIoToken(
  bytes memory params,
  uint offset
) pure returns (IoToken, uint) {
  uint8 ioToken;
  (ioToken, offset) = params.asUint8Unchecked(offset);
  return (IoToken(ioToken), offset);
}

function parseIERC20(
  bytes memory params,
  uint offset
) pure returns (IERC20, uint) {
  address token;
  (token, offset) = params.asAddressUnchecked(offset);
  return (IERC20(token), offset);
}

function parseRedeemMode(
  bytes memory params,
  uint offset
) pure returns (RedeemMode, uint) {
  uint8 redeemMode;
  (redeemMode, offset) = params.asUint8Unchecked(offset);
  return (RedeemMode(redeemMode), offset);
}

function parseRelayParams(
  bytes memory params,
  uint offset
) pure returns (GasDropoff, uint, uint) {
  uint32 gasDropoff;
  uint relayingFee; //either specifies the max relaying fee or the actual relaying fee
  (gasDropoff,  offset) = params.asUint32Unchecked(offset);
  (relayingFee, offset) = params.asUint48Unchecked(offset);
  return (GasDropoff.wrap(gasDropoff), relayingFee, offset);
}
