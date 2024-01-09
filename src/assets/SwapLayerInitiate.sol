// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import { IAllowanceTransfer } from "permit2/IAllowanceTransfer.sol";
import { ISignatureTransfer } from "permit2/ISignatureTransfer.sol";

import { BytesParsing } from "wormhole/WormholeBytesParsing.sol";

import { SwapFailurePolicy } from "./SwapLayerBase.sol";
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

  //selector: 22bf2bd8
  function initiate(
    uint16 targetChain,
    bytes32 recipient, //= redeemer in case of a payload
    bool isExactIn,
    bytes memory params
  ) external payable returns (bytes memory) { unchecked {
    ModesOffsetsSizes memory mos = parseParamBaseStructure(params);

    uint fastTransferFee = 0;
    uint32 fastTransferDeadline = 0;
    if (mos.fastTransfer.mode == FastTransferMode.Enabled) {
      uint offset = mos.fastTransfer.offset;
      (fastTransferFee, offset) = params.asUint64Unchecked(offset);
      (fastTransferDeadline,) = params.asUint32Unchecked(offset);
    }

    uint relayingFee = 0;
    bytes memory redeemPayload;
    if (mos.redeem.mode == RedeemMode.Relay) {
      uint swapCount = 0;
      if (mos.output.mode != IoToken.Usdc) {
        uint offset = mos.output.offset;
        if (mos.output.mode == IoToken.Erc20)
          offset += ADDRESS_SIZE;

        uint pathLength;
        (pathLength,) = parseSwapLength(params, offset);
        swapCount = pathLength + 1;
      }

      (GasDropoff gasDropoff, uint maxRelayingFee, ) =
        parseRelayParams(params, mos.redeem.offset);
      relayingFee = _calcRelayingFee(targetChain, gasDropoff, swapCount);
      if (relayingFee > maxRelayingFee)
        revert ExceedsMaxRelayingFee(relayingFee, maxRelayingFee);

      redeemPayload = encodeRelayParams(gasDropoff, relayingFee);
    }
    else
      (redeemPayload, ) = params.slice(
        mos.redeem.offset - MODE_SIZE,
        mos.redeem.size + MODE_SIZE
      );

    uint usdcAmount = _acquireUsdc(isExactIn, fastTransferFee + relayingFee, mos, params);
    bytes32 endpoint = _getEndpoint(targetChain);
    if (endpoint == bytes32(0))
      revert ChainNotSupported(targetChain);

    (bytes memory outputSwap, ) = params.slice(
      mos.output.offset - MODE_SIZE,
      mos.output.size + MODE_SIZE
    );
    
    bytes memory swapMessage = encodeSwapMessage(recipient, redeemPayload, outputSwap);
    if (mos.fastTransfer.mode == FastTransferMode.Enabled) {
      (uint64 vaaSequence, uint64 cctpSequence, uint64 cctpNonce) =
        _liquidityLayer.placeFastMarketOrder(
          uint128(usdcAmount), //TODO
          targetChain,
          endpoint,
          swapMessage,
          uint128(fastTransferFee), //TODO
          fastTransferDeadline
        );
      return abi.encode(usdcAmount, vaaSequence, cctpSequence, cctpNonce);
    }
    else {
      (uint64 sequence, uint64 cctpNonce) = _liquidityLayer.placeMarketOrder(
        uint128(usdcAmount), //TODO
        targetChain,
        endpoint,
        swapMessage
      );
      return abi.encode(usdcAmount, sequence, cctpNonce);
    }
  }}

  function _acquireUsdc(
    bool isExactIn,
    uint totalFee,
    ModesOffsetsSizes memory mos,
    bytes memory params
  ) private returns (uint usdcAmount) { unchecked {
    IoToken inputTokenType = mos.input.mode;
    uint offset = mos.input.offset;
    if (inputTokenType == IoToken.Usdc) {
      //we received USDC directly
      (usdcAmount, offset) = params.asUint128Unchecked(offset);
      if (isExactIn) {
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
      if (inputTokenType == IoToken.Gas) {
        uint wormholeFee = _wormhole.messageFee();
        if (mos.fastTransfer.mode == FastTransferMode.Enabled)
          wormholeFee *= 2; //fast transfers emit 2 wormhole messages
        if (msg.value < wormholeFee)
          revert InsufficientMsgValue();

        inputAmount = msg.value - wormholeFee;
        _weth.deposit{value: inputAmount}();
        inputToken = _weth;
      } 
      else { //must be IoToken.Erc20
        (inputToken,  offset) = parseIERC20(params, offset);
        (inputAmount, offset) = params.asUint128Unchecked(offset);
        offset = _acquireInputTokens(inputAmount, inputToken, params, offset);
      }

      bool approveCheck; //gas optimization
      (approveCheck, offset) = params.asBoolUnchecked(offset);
      (uint outputAmount, uint256 deadline, bytes memory path, ) =
         parseSwapParams(inputToken, _usdc, params, offset);

      //adjust outputAmount to ensure that the received usdc amount on the target chain is at least
      //  the specified outputAmount
      outputAmount += totalFee;

      uint inOutAmount = _swap(
        isExactIn,
        inputAmount,
        outputAmount,
        inputToken,
        SwapFailurePolicy.Revert,
        approveCheck,
        deadline,
        path
      );

      if (isExactIn)
        usdcAmount = inOutAmount;
      else {
        //return unspent tokens
        if (inOutAmount < inputAmount) {
          uint refundAmount = inputAmount - inOutAmount;
          if (inputTokenType == IoToken.Gas) {
            _weth.withdraw(refundAmount);
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
      inputToken.safeTransferFrom(msg.sender, address(this), inputAmount);
    }
    else { //must be AcquireMode.Permit2Transfer)
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
    return offset;
  }
}


// --------------------  Uniswap V2 related code below --------------------

// import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

// error CannotComposeExactOutAcrossUniswapVersions();

// IUniswapV2Router02 private immutable uniswapV2Router_,

// //Uniswap V3 encodes fees with a precision of 10^-6 using a uint24 datatype, i.e. 1_000_000 = 100%
// //This upper bound is enforced by the factory (see https://github.com/Uniswap/v3-core/blob/d8b1c635c275d2a9450bd6a78f3fa2484fef73eb/contracts/UniswapV3Factory.sol#L63) the 100 % upper bound so we can use 0x800000 as a magic value to
// //So we can denote Uniswap V2 pools in our path encoding scheme using a magic value of
// //  0x800000 = 2^23 = 2^3 * 2^10 * 2^10 ~= 8 * 10^3 * 10^3 = 8_000_000
// //thus saving a tiny amount of gas by having 2 zero bytes in our calldata
// uint24 constant UNI_V2_MAGIC_FEE = 0x800000;

// //returns the consumed input amount on exact out swaps and the output amount on exact in swaps
// function swap(
//   bool isOutAmount,
//   uint inputAmount,
//   uint limitAmount;
//   IERC20 inputToken,
//   IERC20 outputToken,
//   bytes calldata params,
//   uint offset,
// ) private returns (uint, uint) { unchecked {
//   uint256 deadline;
//   uint24 legFirstFee;
//   uint pathLength;
//   (deadline, legFirstFee, pathLength, offset) = parseSwapParams(params, offset);

//   //We accumulate consecutive swaps for V2 and V3 of Uniswap so that we have paths or "legs"
//   //Each set of consecutive swaps is then sent to the respective router before taking the output
//   //  and forwarding it as input to the next leg (now necessarily of the other version)
//   //We only support this for exact in swaps because they compose naturally from front to back.
//   //Exact out swaps on the other hand must be calculated in the opposite order and there is no way
//   //  to determine the required input of an exact out swap with Uniswap V3 without actually
//   //  performing the swap, which means we'd essentially have to reimplement substantial parts of
//   //  the V3 router contract so we can use the uniswapV3SwapCallback function to compose with V2
//   //  and that's not worth the effort.
//   for (uint legStart, legEnd; true; legStart = ++legEnd) {
//     uint tmpOffset = offset + ADDRESS_SIZE;
//     bool isV2Leg = legFirstFee == UNI_V2_MAGIC_FEE;
//     uint24 nextFee;
//     for (; legEnd < pathLength; ++legEnd) { 
//       (nextFee, tmpOffset) = params.asUint24Unchecked(tmpOffset);
//       tmpOffset += ADDRESS_SIZE;
//       if ((nextFee == UNI_V2_MAGIC_FEE) ^ isV2Leg)
//         //We stop when we:
//         //  either hit a UNI_V2_MAGIC_FEE as the next fee while we are not on a V2 leg
//         //  or hit a non-UNI_V2_MAGIC_FEE and we're on a V2 leg
//         //In either case, we've reached the end of the current leg
//         break;
//     }

//     //TODO approve address(isV2Leg ? uniswapV2Router_ : uniV3Router_)
    
//     if (isOutAmount) {
//       //exact out swaps must be composed of a single leg
//       if (legEnd != pathLength)
//         revert CannotComposeExactOutAcrossUniswapVersions();
      
//       uint consumedInput;
//       if (isV2Leg) {
//         address[] memory path = new address[](pathLength + 2);
//         ++pathLength; //gas optimization
//         path[0] = address(inputToken);
//         for (uint i = 1; i < pathLength; ++i) {
//           (path[i], offset) = params.asAddressUnchecked(offset);
//           offset += FEE_SIZE;
//         }
//         path[pathLength] = address(outputToken);

//         consumedInput = uniswapV2Router_.swapTokensForExactTokens(
//           inputAmount,
//           limitAmount,
//           path,
//           address(this),
//           deadline
//         )[0];
//       }
//       else {
//         uint sliceLen = pathLength * UNI_PATH_ELEMENT_SIZE;
//         bytes memory path =
//           abi.encodePacked(inputToken, legFirstFee, params.slice(offset, sliceLen), outputToken);

//         consumedInput = uniV3Router_.exactOutput(ExactOutputParams(
//           path,
//           address(this),
//           deadline,
//           limitAmount,
//           inputAmount,
//         ));

//         offset += sliceLen;
//       }

//       if (consumedInput < inputAmount)
//         inputToken.safeApprove(address(isV2Leg ? uniswapV2Router_ : uniV3Router_), 0);
      
//       return (consumedInput, offset);
//     }
    
//     bool isFinalLeg = legEnd == pathLength;
//     if (isV2Leg) {
//       uint legLength = legEnd - legStart + 2;
//       address[] memory path = new address[](legLength);
//       address[O] = inputToken;
//       if (isFinalLeg) {
//         --legLength; //gas optimization
//         path[legLength] = outputToken;
//       }

//       for (uint i = 1; i < legLength; ++i) {
//         (path[i], offset) = params.asAddressUnchecked(offset);
//         offset += FEE_SIZE;
//       }

//       inputAmount = uniswapV2Router_.swapExactTokensForTokens(
//         inputAmount,
//         isFinalLeg ? limitAmount : 0, //no minimum output amount on intermediate swaps
//         path,
//         address(this),
//         deadline
//       )[legLength];

//       inputToken = path[legLength - 1];
//     }
//     else {
//       bytes memory path;
//       if (isFinalLeg) {
//         uint sliceLen = (legEnd - legStart) * UNI_PATH_ELEMENT_SIZE;
//         path =
//           abi.encodePacked(inputToken, legFirstFee, params.slice(offset, sliceLen), outputToken);
//         offset += sliceLen;
//       }
//       else {
//         uint newOffset = (legEnd - legStart) * UNI_PATH_ELEMENT_SIZE;
//         address nextToken;
//         (nextToken, newOffset) = params.asAddressUnchecked(newOffset);
//         inputToken = IERC20(nextToken);
//         path = abi.encodePacked(inputToken, legFirstFee, params.slice(offset, newOffset));
//         offset = newOffset + FEE_SIZE;
//       }

//       inputAmount = uniV3Router_.exactInput(ExactInputParams(
//         path,
//         address(this),
//         deadline,
//         inputAmount,
//         isFinalLeg ? limitAmount : 0,
//       ));
//     }

//     if (isFinalLeg)
//       return (inputAmount, offset);
    
//     legFirstFee = nextFee;
//     //inputAmount, inputToken, legFirstFee, and offset have all been updated -> loop
//   }
// }}

// //UniswapV2 uses its TransferHelper library (https://github.com/Uniswap/solidity-lib/blob/c01640b0f0f1d8a85cba8de378cc48469fcfd9a6/contracts/libraries/TransferHelper.sol#L33)
// //  to perform transferFrom calls (see e.g. here https://github.com/Uniswap/v2-periphery/blob/0335e8f7e1bd1e8d8329fd300aea2ef2f36dd19f/contracts/UniswapV2Router02.sol#L247)
// //  which reverts with the error message "TransferHelper::transferFrom: transferFrom failed"
// //We use the keccak256 of the error message to check whether a swap failed for that reason
// uint private constant UNIV2_TRANSFER_FROM_FAILED_LENGTH = 49;
// bytes32 private constant UNIV2_TRANSFER_FROM_FAILED_HASH   =
//   0x3f8faf98afe9344b6d4b0e75b0101259bf282914b3b5a9320c6918b6e27ede1c;

// function isUniV2TransferFromFailedReason(string memory reason) private pure returns (bool) {
//   return reason.length == UNIV2_TRANSFER_FROM_FAILED_LENGTH &&
//     keccak256(bytes(reason)) == UNIV2_TRANSFER_FROM_FAILED;
// }


// try uniswapV2Router_.swapExactTokensForTokens(
//   inputAmount,
//   isFinalLeg ? limitAmount : 0, //no minimum output amount on intermediate swaps
//   path,
//   address(this),
//   deadline
// ) returns (uint256 memory amounts) {
//   inputAmount = amounts[legLength];
// } catch Error(string memory reason) {
//   //if we fail due to a missing approval, we set an unlimited approval and try again
//   if (isUniV2TransferFromFailedReason(reason)) {
//     maxApprove(inputToken, address(uniswapV2Router_));

//     inputAmount = uniswapV2Router_.swapExactTokensForTokens(
//       inputAmount,
//       isFinalLeg ? limitAmount : 0, //no minimum output amount on intermediate swaps
//       path,
//       address(this),
//       deadline
//     )[legLength];
//   }
//   else
//     revert(reason);
// }
