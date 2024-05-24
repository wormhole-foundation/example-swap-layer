// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "wormhole-sdk/libraries/BytesParsing.sol";
import { toUniversalAddress, fromUniversalAddress } from "wormhole-sdk/Utils.sol";

import "./Params.sol";

using BytesParsing for bytes;
using { fromUniversalAddress } for bytes32;
using { toUniversalAddress } for address;

uint8 constant VERSION = 1;

error InvalidVersion(uint8 version, uint8 expected);

function encodeSwapMessage(
  bytes32 recipient,
  RedeemMode redeemMode,
  bytes memory redeemPayload,
  bytes memory outputSwap
) pure returns (bytes memory) {
  return abi.encodePacked(
    VERSION,
    recipient,
    redeemMode,
    redeemPayload,
    outputSwap
  );
}

function encodeSwapMessageRelayParams(
  GasDropoff gasDropoff,
  uint relayingFee
) pure returns (bytes memory) {
  return abi.encodePacked(gasDropoff, uint48(relayingFee));
}

function encodeSwapMessagePayloadParams(
  address sender,
  bytes memory payload
) pure returns (bytes memory) {
  return abi.encodePacked(sender.toUniversalAddress(), payload);
}

struct SwapMessageStructure {
  address recipient;
  RedeemMode redeemMode;
  bytes32 sender;
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
  sms.recipient = recipient_.fromUniversalAddress();

  (sms.redeemMode, offset) = parseRedeemMode(message, offset);
  sms.redeemOffset = offset;
  if (sms.redeemMode == RedeemMode.Payload) {
    (sms.sender, offset) = message.asBytes32Unchecked(offset);
    uint payloadLen;
    (payloadLen, offset) = message.asUint16Unchecked(offset);
    (sms.payload, offset) = message.sliceUnchecked(offset, payloadLen);
  }
  else if (sms.redeemMode == RedeemMode.Relay)
    offset += RELAY_PARAM_SIZE;

  sms.swapOffset = offset;
}
