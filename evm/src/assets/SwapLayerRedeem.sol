// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "@openzeppelin/token/ERC20/IERC20.sol";
import "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

import "wormhole-sdk/libraries/BytesParsing.sol";
import { OrderResponse as Attestations, RedeemedFill } from "liquidity-layer/ITokenRouter.sol";

import "./SwapLayerGovernance.sol";
import "./Params.sol";
import { SwapMessageStructure, parseSwapMessageStructure } from "./Message.sol";
import { GasDropoff, GasDropoffLib } from "./GasDropoff.sol";

error SenderNotRecipient(address sender, address recipient);
error InvalidMsgValue(uint256 value, uint256 expected);

abstract contract SwapLayerRedeem is SwapLayerGovernance {
  using BytesParsing for bytes;
  using SafeERC20 for IERC20;

  //params structure:
  //  redeemMode direct:
  //    optionally either empty (=execute what's specified in the message) or used to override
  //      1 byte   input token type
  //        0: USDC
  //        1: GAS
  //          swap struct
  //        2: ERC20
  //         20 bytes  token address
  //          swap struct
  //    if overridden, a failed swap for any reason will revert the transaction (just like initiate)
  //  redeemMode payload/relay:
  //    no extra params allowed

  //selector: 604009a9
  function redeem(
    bytes memory params,
    Attestations calldata attestations
  ) external payable returns (bytes memory) {
    RedeemedFill memory fill = _liquidityLayer.redeemFill(attestations);
    SwapMessageStructure memory sms = parseSwapMessageStructure(fill.message);

    bool senderIsRecipient = msg.sender == sms.recipient;
    bool overrideMsg = false;
    uint gasDropoff = 0;
    uint usdcAmount;
    if (sms.redeemMode == RedeemMode.Relay && !senderIsRecipient) {
      (GasDropoff gasDropoff_, uint relayingFee, ) =
        parseRelayParams(fill.message, sms.redeemOffset);
      _usdc.safeTransfer(_getFeeRecipient(), relayingFee);
      gasDropoff = gasDropoff_.from();
      usdcAmount = fill.amount - relayingFee;

      //no extra params when relaying
      params.checkLength(0);
    }
    else {
      if (sms.redeemMode == RedeemMode.Payload) {
        if (!senderIsRecipient)
          revert SenderNotRecipient(msg.sender, sms.recipient);

        //no extra params when redeeming with payload
        params.checkLength(0);
      }
      else if (!senderIsRecipient)
        params.checkLength(0);
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
      else
        (outputToken, offset) = parseIERC20(swapParams, offset);

      uint256 deadline;
      uint minOutputAmount;
      uint swapType;
      bytes memory path;
      (deadline, minOutputAmount, swapType, path, offset) =
        parseEvmSwapParams(_usdc, outputToken, swapParams, offset);

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
    }

    swapParams.checkLength(offset);

    if (outputAmount == 0) {
      outputTokenType = IoToken.Usdc;
      outputToken = _usdc;
      outputAmount = usdcAmount;
    }

    if (outputTokenType == IoToken.Gas) {
      outputToken = IERC20(address(0)); //0 represets the gas token itself
      outputAmount = outputAmount + gasDropoff;
      _wnative.withdraw(outputAmount);
      _transferEth(sms.recipient, outputAmount);
    }
    else {
      if (gasDropoff > 0)
        _transferEth(sms.recipient, gasDropoff);

      outputToken.safeTransfer(sms.recipient, outputAmount);
    }

    return sms.redeemMode == RedeemMode.Payload
      ? abi.encode(address(outputToken), outputAmount, sms.payload)
      : abi.encode(address(outputToken), outputAmount);
  }
}
