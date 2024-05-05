// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "@openzeppelin/token/ERC20/IERC20.sol";
import "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/token/ERC20/extensions/IERC20Permit.sol";

import "wormhole-sdk/interfaces/token/IPermit2.sol";
import { BytesParsing } from "wormhole-sdk/libraries/BytesParsing.sol";

import "./SwapLayerRelayingFees.sol";
import "./InitiateParams.sol";
import { encodeSwapMessage, encodeRelayParams } from "./Message.sol";

error InsufficientMsgValue();
error InsufficientInputAmount(uint256 input, uint256 minimum);
error InvalidLength(uint256 received, uint256 expected);
error ExceedsMaxRelayingFee(uint256 fee, uint256 maximum);
error ChainNotSupported(uint16 chain);

abstract contract SwapLayerInitiate is SwapLayerRelayingFees {
  using BytesParsing for bytes;
  using SafeERC20 for IERC20;

  function initiate(
    uint16 targetChain,
    bytes32 recipient, //= redeemer in case of a payload
    bytes memory params
  ) external payable returns (bytes memory) { unchecked {
    ModesOffsetsSizes memory mos = parseParamBaseStructure(params);

    uint64 fastTransferFee = 0;
    uint32 fastTransferDeadline = 0;
    if (mos.transfer.mode == TransferMode.LiquidityLayerFast) {
      uint offset = mos.transfer.offset;
      (fastTransferFee, offset) = params.asUint64Unchecked(offset);
      (fastTransferDeadline,) = params.asUint32Unchecked(offset);
    }

    uint relayingFee = 0;
    bytes memory redeemPayload;
    if (mos.redeem.mode == RedeemMode.Relay) {
      (GasDropoff gasDropoff, uint maxRelayingFee, ) = parseRelayParams(params, mos.redeem.offset);
      relayingFee = _calcRelayingFee(targetChain, gasDropoff, params, mos.output);
      if (relayingFee > maxRelayingFee)
        revert ExceedsMaxRelayingFee(relayingFee, maxRelayingFee);

      redeemPayload = encodeRelayParams(gasDropoff, relayingFee);
    }
    else
      (redeemPayload, ) = params.slice(mos.redeem.offset - MODE_SIZE, mos.redeem.size + MODE_SIZE);

    //unchecked cast, but if someone manages to withdraw 10^(19-6), i.e. 10 trillion USDC then
    //  we have other problems regardless (though who knows what the future holds for the "stable"
    //  coin that is the US dollar - or any other fiat currency for that matter)
    uint64 usdcAmount = uint64(_acquireUsdc(uint(fastTransferFee) + relayingFee, mos, params));

    bytes32 peer = _getPeer(targetChain);
    if (peer == bytes32(0))
      revert ChainNotSupported(targetChain);

    (bytes memory outputSwap, ) = params.slice(
      mos.output.offset - MODE_SIZE,
      mos.output.size + MODE_SIZE
    );

    bytes memory swapMessage = encodeSwapMessage(recipient, redeemPayload, outputSwap);
    bytes memory ret;
    if (mos.transfer.mode == TransferMode.LiquidityLayerFast) {
      (uint64 sequence, uint64 fastSequence, uint256 protocolSequence) =
        _liquidityLayer.placeFastMarketOrder(
          usdcAmount,
          targetChain,
          peer,
          swapMessage,
          fastTransferFee,
          fastTransferDeadline
        );

      ret = abi.encode(usdcAmount, sequence, protocolSequence, fastSequence);
    }
    else if (mos.transfer.mode == TransferMode.LiquidityLayer) {
      (uint64 sequence, uint256 protocolSequence) = _liquidityLayer.placeMarketOrder(
        usdcAmount,
        targetChain,
        peer,
        swapMessage
      );

      ret = abi.encode(usdcAmount, sequence, protocolSequence);
    }
    else
      _assertExhaustive();

    return (mos.redeem.mode == RedeemMode.Relay)
      ? abi.encodePacked(ret, relayingFee)
      : ret;
  }}

  function _acquireUsdc(
    uint totalFee,
    ModesOffsetsSizes memory mos,
    bytes memory params
  ) private returns (uint usdcAmount) { unchecked {
    IoToken inputTokenType = mos.input.mode;
    uint offset = mos.input.offset;
    if (inputTokenType == IoToken.Usdc) {
      //we received USDC directly
      (usdcAmount, offset) = params.asUint128Unchecked(offset);
      if (mos.isExactIn) {
        if (usdcAmount < totalFee)
          revert InsufficientInputAmount(usdcAmount, totalFee);
      }
      else
        usdcAmount += totalFee;

      _acquireInputTokens(usdcAmount, _usdc, params, offset);
    }
    else {
      //we received something else than usdc so we'll have to perform at least one swap
      uint inputAmount;
      IERC20 inputToken;
      bool approveCheck = false; //gas optimization
      if (inputTokenType == IoToken.Gas) {
        uint wormholeFee = _wormhole.messageFee();
        if (mos.transfer.mode == TransferMode.LiquidityLayerFast)
          wormholeFee *= 2; //fast transfers emit 2 wormhole messages
        if (msg.value < wormholeFee)
          revert InsufficientMsgValue();

        inputAmount = msg.value - wormholeFee;
        _wnative.deposit{value: inputAmount}();
        inputToken = IERC20(address(_wnative));
      }
      else if (inputTokenType == IoToken.Other) {
        (inputToken,  offset) = parseIERC20(params, offset);
        (inputAmount, offset) = params.asUint128Unchecked(offset);
        offset = _acquireInputTokens(inputAmount, inputToken, params, offset);
        (approveCheck, offset) = params.asBoolUnchecked(offset);
      }
      else
        _assertExhaustive();

      (uint256 deadline, uint outputAmount, uint swapType, bytes memory path, ) =
        parseEvmSwapParams(address(inputToken), address(_usdc), params, offset);

      //adjust outputAmount to ensure that the received usdc amount on the target chain is at least
      //  the specified outputAmount
      outputAmount += totalFee;

      uint inOutAmount = _swap(
        swapType,
        mos.isExactIn,
        inputAmount,
        outputAmount,
        inputToken,
        _usdc,
        true, //revert on failure
        approveCheck,
        deadline,
        path
      );

      if (mos.isExactIn)
        usdcAmount = inOutAmount;
      else {
        //return unspent tokens
        if (inOutAmount < inputAmount) {
          uint refundAmount = inputAmount - inOutAmount;
          if (inputTokenType == IoToken.Gas) {
            _wnative.withdraw(refundAmount);
            _transferEth(msg.sender, refundAmount);
          }
          else
            inputToken.safeTransfer(msg.sender, refundAmount);
        }
        usdcAmount = outputAmount;
      }
    }
  }}

  function _acquireInputTokens(
    uint inputAmount,
    IERC20 inputToken,
    bytes memory params,
    uint offset
  ) private returns (uint /*offset*/) {
    uint8 _acquireMode;
    (_acquireMode, offset) = params.asUint8Unchecked(offset);
    AcquireMode acquireMode = AcquireMode(_acquireMode);
    if (acquireMode == AcquireMode.Preapproved)
      inputToken.safeTransferFrom(msg.sender, address(this), inputAmount);
    else if (acquireMode == AcquireMode.Permit) {
      uint256 value; uint256 deadline; bytes32 r; bytes32 s; uint8 v;
      (value, deadline, r, s, v, offset) = parsePermit(params, offset);
      IERC20Permit(address(inputToken)).permit(msg.sender, address(this), value, deadline, v, r, s);
      inputToken.safeTransferFrom(msg.sender, address(this), inputAmount);
    }
    else if (acquireMode == AcquireMode.Permit2Transfer) {
      uint256 amount; uint256 nonce; uint256 sigDeadline; bytes memory signature;
      (amount, nonce, sigDeadline, signature, offset) = parsePermit2Transfer(params, offset);
      _permit2.permitTransferFrom(
        ISignatureTransfer.PermitTransferFrom({
          permitted: ISignatureTransfer.TokenPermissions(address(inputToken), amount),
          nonce: nonce,
          deadline: sigDeadline
        }),
        ISignatureTransfer.SignatureTransferDetails(address(this), inputAmount),
        msg.sender,
        signature
      );
    }
    else if (acquireMode == AcquireMode.Permit2Permit) {
      uint160 amount; uint48 expiration; uint48 nonce; uint256 sigDeadline; bytes memory signature;
      (amount, expiration, nonce, sigDeadline, signature, offset) =
        parsePermit2Permit(params, offset);
      _permit2.permit(
        msg.sender,
        IAllowanceTransfer.PermitSingle({
          details: IAllowanceTransfer.PermitDetails(address(inputToken), amount, expiration, nonce),
          spender: address(this),
          sigDeadline: sigDeadline
        }),
        signature
      );
      _permit2.transferFrom(msg.sender, address(this), uint160(inputAmount), address(inputToken));
    }
    else
      _assertExhaustive();

    return offset;
  }
}
