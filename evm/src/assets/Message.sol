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
  address sender,
  bytes memory redeemPayload,
  bytes memory outputSwap
) pure returns (bytes memory) {
  return abi.encodePacked(
    VERSION,
    recipient,
    sender.toUniversalAddress(),
    redeemPayload,
    outputSwap
  );
}

function encodeSwapMessageRelayParams(
  GasDropoff gasDropoff,
  uint relayingFee
) pure returns (bytes memory) {
  return abi.encodePacked(uint8(RedeemMode.Relay), gasDropoff, uint48(relayingFee));
}

struct SwapMessageStructure {
  address recipient;
  bytes32 sender;
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
  sms.recipient = recipient_.fromUniversalAddress();
  (sms.sender, offset) = message.asBytes32Unchecked(offset);

  (sms.redeemMode, offset) = parseRedeemMode(message, offset);
  sms.redeemOffset = offset;
  if (sms.redeemMode == RedeemMode.Payload) {
    uint payloadLen;
    (payloadLen, offset) = message.asUint16Unchecked(offset);
    (sms.payload, offset) = message.sliceUnchecked(offset, payloadLen);
  }
  else if (sms.redeemMode == RedeemMode.Relay)
    offset += RELAY_PARAM_SIZE;

  sms.swapOffset = offset;
}
