// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { BytesParsing } from "wormhole/libraries/BytesParsing.sol";
import { GasDropoff, GasDropoffLib } from "./GasDropoff.sol";

using BytesParsing for bytes;
using GasDropoffLib for GasDropoff;

uint constant MODE_SIZE = 1;
uint constant BOOL_SIZE = 1;
uint constant ADDRESS_SIZE = 20;
uint constant UNIVERSAL_ADDRESS_SIZE = 32;
uint constant SWAP_PARAM_DEADLINE_SIZE = 4;
uint constant SWAP_PARAM_AMOUNT_SIZE = 16;
uint constant SWAP_PARAM_SWAP_TYPE_SIZE = 1;

uint constant UNISWAP_FEE_SIZE = 3;

uint constant TRADERJOE_VERSION_SIZE = 1;
//binsteps in the router interface are coded as uint256, but the true underlying datatype is uint16:
//https://github.com/traderjoe-xyz/joe-v2/blob/31e31f65c6e6e183d42dec8029aca5443fa2a2c3/src/LBPair.sol#L150
uint constant TRADERJOE_BINSTEP_SIZE = 2;

//serendipitously, we require 3 bytes for uniswapV3 and traderJoe so we can combine the code
uint constant SHARED_POOL_ID_SIZE = 3;
uint constant SHARED_PATH_ELEMENT_SIZE = ADDRESS_SIZE + SHARED_POOL_ID_SIZE;

uint constant RELAY_GAS_DROPOFF_SIZE     = 4;
uint constant RELAY_MAX_RELAYER_FEE_SIZE = 6;
uint constant RELAY_PARAM_SIZE = RELAY_GAS_DROPOFF_SIZE + RELAY_MAX_RELAYER_FEE_SIZE;

enum IoToken {
  Usdc,
  Gas,
  Other
}

enum RedeemMode {
  Direct,
  Payload,
  Relay
}

enum SwapType {
  UniswapV3,
  TraderJoe
}

//swap layout:
// 4 bytes  deadline (unix timestamp, 0 = no deadline)
//16 bytes  limitAmount
// 1 byte   swapType
// 3 bytes  firstPoolId
// 1 byte   pathLength
// n bytes  swap path (n = pathLength * (20+3) (token address + uni fee))

function parseSwapParams(
  IERC20 inputToken,
  IERC20 outputToken,
  bytes memory params,
  uint offset
) pure returns (uint, uint256, SwapType, bytes memory, uint) { unchecked {
  uint256 deadline;
  uint limitAmount;
  SwapType swapType;
  uint24 firstPoolId;
  uint pathLength; //total number of swaps = pathLength + 1
  (deadline,    offset) = params.asUint32Unchecked(offset);
  (limitAmount, offset) = params.asUint128Unchecked(offset);
  (swapType,    offset) = parseSwapType(params, offset);
  (firstPoolId, offset) = params.asUint24Unchecked(offset);
  (pathLength,  offset) = params.asUint8Unchecked(offset);

  uint sliceLen;
  sliceLen = pathLength * SHARED_PATH_ELEMENT_SIZE;
  bytes memory partialPath;
  (partialPath, offset) = params.sliceUnchecked(offset, sliceLen);
  bytes memory path = abi.encodePacked(
    address(inputToken),
    firstPoolId,
    partialPath,
    address(outputToken)
  );

  return (deadline, limitAmount, swapType, path, offset);
}}

//total number of swaps = pathLength + 1
function parseSwapLength(
  bytes memory params,
  uint offset
) pure returns (uint /*pathLength*/, uint) { unchecked {
  offset += SWAP_PARAM_DEADLINE_SIZE  + SWAP_PARAM_AMOUNT_SIZE +
            SWAP_PARAM_SWAP_TYPE_SIZE + SHARED_POOL_ID_SIZE;
  return params.asUint8Unchecked(offset);
}}

function skipSwap(
  bytes memory params,
  uint offset
) pure returns (uint) { unchecked {
  uint pathLength; //total number of swaps = pathLength + 1
  (pathLength, offset) = parseSwapLength(params, offset);
  offset += pathLength * SHARED_PATH_ELEMENT_SIZE;
  return offset;
}}

function parseSwapType(
  bytes memory params,
  uint offset
) pure returns (SwapType, uint) {
  uint8 swapType;
  (swapType, offset) = params.asUint8Unchecked(offset);
  return (SwapType(swapType), offset);
}

function parseIoToken(
  bytes memory params,
  uint offset
) pure returns (IoToken ret, uint) {
  uint8 val;
  (val, offset) = params.asUint8Unchecked(offset);
  return (IoToken(val), offset);
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
  uint8 val;
  (val, offset) = params.asUint8Unchecked(offset);
  return (RedeemMode(val), offset);
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
