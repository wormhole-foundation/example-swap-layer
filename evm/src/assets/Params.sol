// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "@openzeppelin/token/ERC20/IERC20.sol";

import "wormhole-sdk/libraries/BytesParsing.sol";
import { GasDropoff, GasDropoffLib } from "./GasDropoff.sol";

using BytesParsing for bytes;

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

//not using an enum here to allow custom values, better grouping and not panicing on parse failure
uint constant SWAP_TYPE_INVALID = 0; //special, internal only value
//group evm swap types in 1-16
uint constant SWAP_TYPE_UNISWAPV3 = 1;
uint constant SWAP_TYPE_TRADERJOE = 2;
//group solana swap types starting at 16
uint constant SWAP_TYPE_GENERIC_SOLANA = 16; //TODO

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

//swap layout:
// 4 bytes  deadline (unix timestamp, 0 = no deadline)
//16 bytes  limitAmount
// 1 byte   swapType
//followed by depending on swapType:
// * uniswap or traderjoe:
//   3 bytes  firstPoolId
//   1 byte   pathLength
//   n bytes  swap path (n = pathLength * (20+3) (token address + uni fee))
// * solana:
//   TODO

function parseEvmSwapParams(
  IERC20 inputToken,
  IERC20 outputToken,
  bytes memory params,
  uint offset
) pure returns (uint, uint256, uint, bytes memory, uint) { unchecked {
  uint256 deadline;
  uint limitAmount;
  uint swapType;
  uint24 firstPoolId;
  uint pathLength; //total number of swaps = pathLength + 1
  (deadline,    offset) = params.asUint32Unchecked(offset);
  (limitAmount, offset) = params.asUint128Unchecked(offset);
  (swapType,    offset) = params.asUint8Unchecked(offset);
  if (swapType != SWAP_TYPE_UNISWAPV3 && swapType != SWAP_TYPE_TRADERJOE)
    return (deadline, limitAmount, SWAP_TYPE_INVALID, new bytes(0), params.length);

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

function parseSwapTypeAndCount(
  bytes memory params,
  uint offset
) pure returns (uint, uint, uint) { unchecked {
  uint swapType;
  uint swapCount;
  offset += SWAP_PARAM_DEADLINE_SIZE + SWAP_PARAM_AMOUNT_SIZE;
  (swapType, offset) = params.asUint8Unchecked(offset);
  if (swapType == SWAP_TYPE_UNISWAPV3 || swapType == SWAP_TYPE_TRADERJOE) {
    offset += SHARED_POOL_ID_SIZE;
    uint pathLength;
    (pathLength, offset) = params.asUint8Unchecked(offset);
    swapCount = pathLength + 1;
  }
  else if (swapType == SWAP_TYPE_GENERIC_SOLANA) {
    //TODO SOLANA swapCount for solana swap type(s)
    (swapCount, offset) = params.asUint8Unchecked(offset);
  }
  else
    (swapType, swapCount, offset) = (SWAP_TYPE_INVALID, 0, params.length);

  return (swapType, swapCount, offset);
}}

function skipSwap(
  bytes memory params,
  uint offset
) pure returns (uint) { unchecked {
  uint swapType;
  uint swapCount;
  (swapType, swapCount, offset) = parseSwapTypeAndCount(params, offset);
  if (swapType == SWAP_TYPE_UNISWAPV3 || swapType == SWAP_TYPE_TRADERJOE)
    offset += (swapCount - 1) * SHARED_PATH_ELEMENT_SIZE;
  else if (swapType == SWAP_TYPE_GENERIC_SOLANA) {
    //TODO SOLANA skip for solana swap type(s)
  }
  return offset;
}}

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
