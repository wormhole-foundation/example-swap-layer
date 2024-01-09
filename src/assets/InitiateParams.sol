// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import { BytesParsing } from "wormhole/WormholeBytesParsing.sol";

import "./Params.sol";

using BytesParsing for bytes;

enum FastTransferMode {
  Disabled,
  Enabled
}

enum AcquireMode {
  Preapproved,
  Permit,
  Permit2Permit,
  Permit2Transfer
}

uint constant FAST_TRANSFER_MAX_FEE_SIZE  = 6;
uint constant FAST_TRANSFER_DEADLINE_SIZE = 4;
uint constant FAST_TRANSFER_PARAM_SIZE = FAST_TRANSFER_MAX_FEE_SIZE + FAST_TRANSFER_DEADLINE_SIZE;

uint constant SIGNATURE_SIZE = 65;

uint constant PERMIT_VALUE_SIZE = 32;
uint constant PERMIT_DEADLINE_SIZE = 32;
uint constant PERMIT_SIZE = PERMIT_VALUE_SIZE + PERMIT_DEADLINE_SIZE + SIGNATURE_SIZE;

uint constant PERMIT2_PERMIT_AMOUNT_SIZE = 20;
uint constant PERMIT2_PERMIT_EXPIRATION_SIZE = 6;
uint constant PERMIT2_PERMIT_NONCE_SIZE = 6;
uint constant PERMIT2_PERMIT_SIG_DEADLINE_SIZE = 32;
uint constant PERMIT2_PERMIT_SIZE =
  PERMIT2_PERMIT_AMOUNT_SIZE +
  PERMIT2_PERMIT_EXPIRATION_SIZE +
  PERMIT2_PERMIT_NONCE_SIZE +
  PERMIT2_PERMIT_SIG_DEADLINE_SIZE +
  SIGNATURE_SIZE;

uint constant PERMIT2_TRANSFER_AMOUNT_SIZE = 32;
uint constant PERMIT2_TRANSFER_NONCE_SIZE = 32;
uint constant PERMIT2_TRANSFER_SIG_DEADLINE_SIZE = 32;
uint constant PERMIT2_TRANSFER_SIZE =
  PERMIT2_TRANSFER_AMOUNT_SIZE +
  PERMIT2_TRANSFER_NONCE_SIZE +
  PERMIT2_TRANSFER_SIG_DEADLINE_SIZE +
  SIGNATURE_SIZE;

//we don't support DAI's non-standard permit so it has to go through the permit2 interface
//we can't be more efficient with the datatypes here because the user might have used
//  e.g. MAX_UINT256 for the deadline when signing and then we wouldn't be able to reproduce that
//
//acquire layout:
// 1 byte ACQUIRE_MODE
//  PREAPPROVED:
//  PERMIT:
//    32 bytes  value
//    32 bytes  deadline
//    65 bytes  signature (r, s, v)
//  PERMIT2_PERMIT:
//    20 bytes  amount
//     6 bytes  expiration
//     6 bytes  nonce
//    32 bytes  sigDeadline
//    65 bytes  signature (r, s, v)
//  PERMIT2_TRANSFER:
//    32 bytes  amount
//    32 bytes  nonce
//    32 bytes  sigDeadline
//    65 bytes  signature (r, s, v)

//initiate param layout:
// 1 byte   fast transfer
//  0: no
//  1: yes
//    6 bytes  max fee
//    4 bytes  deadline
//
// 1 byte   redeem mode
//  0: direct
//  1: payload
//    4 bytes  length
//    n bytes  payload (n = length)
//  2: relay
//    4 bytes  gas dropoff (in microether, i.e. 1 eth = 10**6)
//    6 bytes  max relayer fee (in atomic usdc, i.e. 6 decimals -> 1e6 = 1 usdc)
//
// 1 byte   output token type
//  0: USDC
//  1: GAS
//   16 bytes  input amount
//    swap struct
//  2: ERC20
//   20 bytes  token address
//   16 bytes  input amount
//    swap struct
//
// 1 byte   input token type
//  0: USDC
//    acquire layout
//   16 bytes  input amount
//  1: GAS
//    1 byte   approveCheck
//    swap struct
//  2: ERC20
//    acquire layout
//    1 byte   approveCheck
//   20 bytes  token address
//   16 bytes  input amount
//    swap struct

struct FastTransferMOS {
  FastTransferMode mode;
  uint offset;
  uint size;
}

struct RedeemMOS {
  RedeemMode mode;
  uint offset;
  uint size;
}

struct IoTokenMOS {
  IoToken mode;
  uint offset;
  uint size;
}

struct ModesOffsetsSizes {
  FastTransferMOS fastTransfer;
  RedeemMOS redeem;
  IoTokenMOS output;
  IoTokenMOS input;
}

function parseParamBaseStructure(
  bytes memory params
) pure returns (ModesOffsetsSizes memory mos) { unchecked {
  uint offset = 0;
  uint paramBlockOffset;
  {
    uint8 fastTransferMode_;
    (fastTransferMode_, offset) = params.asUint8Unchecked(offset);
    FastTransferMode fastTransferMode = FastTransferMode(fastTransferMode_);
    paramBlockOffset = offset;
    if (fastTransferMode == FastTransferMode.Enabled)
      offset += FAST_TRANSFER_PARAM_SIZE;

    mos.fastTransfer =
      FastTransferMOS(fastTransferMode, paramBlockOffset, paramBlockOffset - offset);
  }
  {
    RedeemMode redeemMode;
    (redeemMode, offset) = parseRedeemMode(params, offset);
    paramBlockOffset = offset;
    if (redeemMode == RedeemMode.Payload) {
      uint payloadLen;
      (payloadLen, offset) = params.asUint32Unchecked(offset);
      offset += payloadLen;
    }
    else if (redeemMode == RedeemMode.Relay)
      offset += RELAY_PARAM_SIZE;

    mos.redeem = RedeemMOS(redeemMode, paramBlockOffset, paramBlockOffset - offset);
  }
  {
    IoToken outputTokenType;
    (outputTokenType, offset) = parseIoToken(params, offset);
    paramBlockOffset = offset;
    if (outputTokenType == IoToken.Gas)
      skipSwap(params, offset);
    else if (outputTokenType == IoToken.Erc20) {
      offset += ADDRESS_SIZE; //token address
      skipSwap(params, offset);
    }

    mos.output = IoTokenMOS(outputTokenType, offset, paramBlockOffset - offset);
  }
  {
    IoToken inputTokenType;
    (inputTokenType, offset) = parseIoToken(params, offset);
    paramBlockOffset = offset;
    if (inputTokenType == IoToken.Usdc) {
      offset += SWAP_PARAM_AMOUNT_SIZE;
      offset = skipAcquire(params, offset);
    }
    else if (inputTokenType == IoToken.Gas) {
      offset += BOOL_SIZE; //approveCheck
      offset = skipSwap(params, offset);
    }
    else if (inputTokenType == IoToken.Erc20) {
      offset = skipAcquire(params, offset);
      offset += ADDRESS_SIZE + SWAP_PARAM_AMOUNT_SIZE + BOOL_SIZE;
      offset = skipSwap(params, offset);
    }

    mos.input = IoTokenMOS(inputTokenType, paramBlockOffset, paramBlockOffset - offset);
  }
  params.checkLength(offset);
}}

//gas optimization - cheaper than if else branch
uint constant _ACQUIRE_MODE_SIZES_ARRAY =
  PERMIT_SIZE << 8 + PERMIT2_PERMIT_SIZE << 16 + PERMIT2_TRANSFER_SIZE << 24;
function skipAcquire(
  bytes memory params,
  uint offset
) pure returns (uint) { unchecked {
  uint8 acquireMode_;
  (acquireMode_, offset) = params.asUint8Unchecked(offset);
  AcquireMode acquireMode = AcquireMode(acquireMode_); //checks that the enum value is valid
  return offset + uint8(_ACQUIRE_MODE_SIZES_ARRAY >> (uint(acquireMode) * 8));
}}

function parsePermit(
  bytes memory params,
  uint offset
) pure returns (uint256, uint256, bytes32, bytes32, uint8, uint) {
  uint256 value;
  uint256 deadline;
  bytes32 r;
  bytes32 s;
  uint8 v;
  (value,    offset) = params.asUint256Unchecked(offset);
  (deadline, offset) = params.asUint256Unchecked(offset);
  (r,        offset) = params.asBytes32Unchecked(offset);
  (s,        offset) = params.asBytes32Unchecked(offset);
  (v,        offset) = params.asUint8Unchecked(offset);
  return (value, deadline, r, s, v, offset);
}

function parsePermit2Permit(
  bytes memory params,
  uint offset
) pure returns (uint160, uint48, uint48, uint256, bytes memory, uint) {
  uint160 amount;
  uint48 expiration;
  uint48 nonce;
  uint256 sigDeadline;
  bytes memory signature;
  (amount,      offset) = params.asUint160Unchecked(offset);
  (expiration,  offset) = params.asUint48Unchecked(offset);
  (nonce,       offset) = params.asUint48Unchecked(offset);
  (sigDeadline, offset) = params.asUint256Unchecked(offset);
  (signature,   offset) = params.slice(offset, SIGNATURE_SIZE);
  return (amount, expiration, nonce, sigDeadline, signature, offset);
}

function parsePermit2Transfer(
  bytes memory params,
  uint offset
) pure returns (uint256, uint256, uint256, bytes memory, uint) {
  uint256 amount;
  uint256 nonce;
  uint256 sigDeadline;
  bytes memory signature;
  (amount,      offset) = params.asUint256Unchecked(offset);
  (nonce,       offset) = params.asUint256Unchecked(offset);
  (sigDeadline, offset) = params.asUint256Unchecked(offset);
  (signature,   offset) = params.slice(offset, SIGNATURE_SIZE);
  return (amount, nonce, sigDeadline, signature, offset);
}
