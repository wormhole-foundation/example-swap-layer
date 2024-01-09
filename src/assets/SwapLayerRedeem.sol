// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { BytesParsing } from "wormhole/WormholeBytesParsing.sol";
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
  using GasDropoffLib for GasDropoff;

  //params structure:
  //  redeemMode direct:
  //    optionally either empty (=execute what's specified in the message) or used to override
  //      1 byte   input token type
  //        0: USDC
  //        1: GAS
  //          1 byte   approveCheck
  //          swap struct
  //        2: ERC20
  //          1 byte   approveCheck
  //         20 bytes  token address
  //          swap struct
  //    if overridden, a failed swap for any reason will revert the transaction (just like initiate)
  //  redeemMode payload:
  //    no extra params allowed
  //  redeemMode relay:
  //    1 byte   approveCheck
  //    but the transaction will fail if the swap fails due to an insufficient allowance
  //    this allows the relayer to save gas while protecting the user from malice/negligence

  //selector: 604009a9
  function redeem(
    bytes memory params,
    Attestations calldata attestations
  ) external payable returns (bytes memory) {
    RedeemedFill memory fill = _liquidityLayer.redeemFill(attestations);
    SwapMessageStructure memory sms = parseSwapMessageStructure(fill.message);
    
    (bool overrideMsg, SwapFailurePolicy failurePolicy) =
      sms.redeemMode == RedeemMode.Direct
      ? msg.sender == sms.recipient && params.length > 0
        ? (true, SwapFailurePolicy.Revert)
        : (false, SwapFailurePolicy.Return)
      : (false,
          sms.redeemMode == RedeemMode.Relay
          ? SwapFailurePolicy.RevertOnInsufficientAllowance
          : SwapFailurePolicy.Return
        );
    
    uint gasDropoff = 0;
    uint usdcAmount;
    if (sms.redeemMode == RedeemMode.Relay) {
      (GasDropoff gasDropoff_, uint relayingFee, ) =
        parseRelayParams(fill.message, sms.redeemOffset);
      _usdc.safeTransfer(_getFeeRecipient(), relayingFee);
      gasDropoff = gasDropoff_.from();
      usdcAmount = fill.amount - relayingFee;
    }
    else {
      if (sms.redeemMode == RedeemMode.Payload) {
        if (msg.sender != sms.recipient)
          revert SenderNotRecipient(msg.sender, sms.recipient);

        //no extra params when redeeming with payload
        params.checkLength(0);
      }
      
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
        outputToken = _weth;
      else
        (outputToken, offset) = parseIERC20(swapParams, offset);

      bool approveCheck;
      if (overrideMsg)
        (approveCheck, offset) = swapParams.asBoolUnchecked(offset);
      else if (sms.redeemMode == RedeemMode.Relay && params.length > 0) {
        uint paramOffset = 0;
        (approveCheck, paramOffset) = params.asBoolUnchecked(paramOffset); //params!
        params.checkLength(paramOffset);
      }
      else
        approveCheck = true;
      
      (uint minOutputAmount, uint256 deadline, bytes memory path, ) =
        parseSwapParams(_usdc, outputToken, swapParams, offset);

      outputAmount = _swap(
        true,
        usdcAmount,
        minOutputAmount,
        _usdc,
        failurePolicy,
        approveCheck,
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
      _weth.withdraw(outputAmount);
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