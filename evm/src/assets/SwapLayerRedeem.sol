// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "@openzeppelin/token/ERC20/IERC20.sol";
import "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

import "wormhole-sdk/libraries/BytesParsing.sol";
import { OrderResponse, RedeemedFill } from "liquidity-layer/interfaces/ITokenRouter.sol";

import "./SwapLayerGovernance.sol";
import "./Params.sol";
import { SwapMessageStructure, parseSwapMessageStructure } from "./Message.sol";
import { GasDropoff, GasDropoffLib } from "./GasDropoff.sol";

enum AttestationType {
  LiquidityLayer
  //TokenBridge
}

error SenderNotRecipient(address sender, address recipient);
error InvalidMsgValue(uint256 value, uint256 expected);
error NoExtraParamsAllowed();

event Redeemed(
  address indexed recipient,
  address outputToken,
  uint256 outputAmount,
  uint256 relayingFee
);

abstract contract SwapLayerRedeem is SwapLayerGovernance {
  using BytesParsing for bytes;
  using SafeERC20 for IERC20;

  //params structure:
  //  redeemMode direct/payload:
  //    optionally either empty (=execute what's specified in the message) or used to override
  //      1 byte   input token type
  //        0: USDC
  //        1: GAS
  //          swap struct
  //        2: ERC20
  //         20 bytes  token address
  //          swap struct
  //    if overridden, a failed swap for any reason will revert the transaction (just like initiate)
  //  redeemMode relay:
  //    no extra params allowed

  function redeem(
    AttestationType, //checked but otherwise ignored, only LiquidityLayer is supported for now
    bytes calldata attestation,
    bytes calldata params
  ) external payable returns (bytes memory) {
    RedeemedFill memory fill = _liquidityLayer.redeemFill(abi.decode(attestation, (OrderResponse)));
    SwapMessageStructure memory sms = parseSwapMessageStructure(fill.message);

    bool senderIsRecipient = msg.sender == sms.recipient;
    bool overrideMsg = false;
    uint gasDropoff = 0;
    uint usdcAmount;
    uint relayingFee = 0;
    if (sms.redeemMode == RedeemMode.Relay && !senderIsRecipient) {
      GasDropoff gasDropoff_;
      (gasDropoff_, relayingFee, ) = parseRelayParams(fill.message, sms.redeemOffset);
      _usdc.safeTransfer(_getFeeRecipient(), relayingFee);
      gasDropoff = gasDropoff_.from();
      usdcAmount = fill.amount - relayingFee;

      if (params.length != 0)
        //no extra params when relaying
        revert NoExtraParamsAllowed();
    }
    else {
      if (!senderIsRecipient) {
        if (sms.redeemMode == RedeemMode.Payload)
          revert SenderNotRecipient(msg.sender, sms.recipient);
        else if (params.length != 0)
          //no extra params when redeeming for someone else
          revert NoExtraParamsAllowed();
      }
      else
        overrideMsg = params.length > 0;

      usdcAmount = fill.amount;
    }

    if (msg.value != gasDropoff)
      revert InvalidMsgValue(msg.value, gasDropoff);

    (bytes memory swapParams, uint offset) = overrideMsg
      ? (params, 0)
      : (fill.message, sms.swapOffset);

    IoToken outputTokenType;
    (outputTokenType, offset) = parseIoToken(swapParams, offset);

    IERC20 outputToken;
    uint outputAmount;
    if (outputTokenType == IoToken.Usdc) {
      outputToken = _usdc;
      outputAmount = usdcAmount;
    }
    else {
      if (outputTokenType == IoToken.Gas)
        outputToken = IERC20(address(_wnative));
      else {
        offset += UNIVERSAL_ADDRESS_SIZE - ADDRESS_SIZE; //skip 12 zero bytes
        (outputToken, offset) = parseIERC20(swapParams, offset);
      }

      uint deadline;
      uint minOutputAmount;
      uint swapType;
      bytes memory path;
      (deadline, minOutputAmount, swapType, path, offset) =
        parseEvmSwapParams(address(_usdc), address(outputToken), swapParams, offset);

      outputAmount = _swap(
        swapType,
        true, //only exact input swaps on redeem for simplicity
        usdcAmount,
        minOutputAmount,
        _usdc,
        outputToken,
        false, //never revert on failed swap - worst case, recipient receives usdc
        false, //always skip approve check, we have max approve with the routers for usdc
        deadline,
        path
      );

      if (outputAmount == 0) {
        outputTokenType = IoToken.Usdc;
        outputToken = _usdc;
        outputAmount = usdcAmount;
      }
    }

    swapParams.checkLength(offset);

    if (outputTokenType == IoToken.Gas) {
      outputToken = IERC20(address(0)); //0 represents the gas token itself
      _wnative.withdraw(outputAmount);
      outputAmount = outputAmount + gasDropoff;
      _transferEth(sms.recipient, outputAmount);
    }
    else {
      if (gasDropoff > 0)
        _transferEth(sms.recipient, gasDropoff);

      outputToken.safeTransfer(sms.recipient, outputAmount);
    }

    emit Redeemed(sms.recipient, address(outputToken), outputAmount, relayingFee);

    return sms.redeemMode == RedeemMode.Payload
      ? abi.encode(address(outputToken), outputAmount, sms.sender, sms.payload)
      : abi.encode(address(outputToken), outputAmount);
  }
}
