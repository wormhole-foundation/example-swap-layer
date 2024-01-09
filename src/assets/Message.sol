// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import { BytesParsing } from "wormhole/WormholeBytesParsing.sol";
import { fromUniversalAddress } from "wormhole/Utils.sol";

import "./Params.sol";

using BytesParsing for bytes;

uint8 constant VERSION = 1;

error InvalidVersion(uint8 version, uint8 expected);

function encodeSwapMessage(
  bytes32 recipient,
  bytes memory redeemPayload,
  bytes memory outputSwap
) pure returns (bytes memory) {
  return abi.encodePacked(VERSION, recipient, redeemPayload, outputSwap);
}

function encodeRelayParams(
  GasDropoff gasDropoff,
  uint relayingFee
) pure returns (bytes memory) {
  return abi.encodePacked(uint8(RedeemMode.Relay), gasDropoff, uint48(relayingFee));
}

struct SwapMessageStructure {
  address recipient;
  RedeemMode redeemMode;
  bytes payload;
  uint redeemOffset;
  uint swapOffset;
}

function parseSwapMessageStructure(
  bytes memory message
) pure returns (SwapMessageStructure memory sms) {
  uint offset = 0;
  uint8 version;
  (version, offset) = message.asUint8Unchecked(offset);
  if (version != VERSION)
    revert InvalidVersion(version, VERSION);
  
  bytes32 recipient_;
  (recipient_, offset) = message.asBytes32Unchecked(offset);
  sms.recipient = fromUniversalAddress(recipient_);

  (sms.redeemMode, offset) = parseRedeemMode(message, offset);
  sms.redeemOffset = offset;
  if (sms.redeemMode == RedeemMode.Payload) {
    uint payloadLen;
    (payloadLen, offset) = message.asUint32Unchecked(offset);
    (sms.payload, offset) = message.slice(offset, payloadLen);
  }
  else if (sms.redeemMode == RedeemMode.Relay)
    offset += RELAY_PARAM_SIZE;
  
  sms.swapOffset = offset;
}
