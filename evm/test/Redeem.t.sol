// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { console2 as console } from "forge-std/console2.sol";

import { toUniversalAddress } from "wormhole-sdk/Utils.sol";

import { Messages } from "liquidity-layer/shared/Messages.sol";
import { OrderResponse } from "liquidity-layer/interfaces/ITokenRouter.sol";

import "swap-layer/SwapLayerIntegrationBase.sol";
import { encodeSwapMessage } from "swap-layer/assets/Message.sol";
import {
  SenderNotRecipient,
  InvalidMsgValue,
  NoExtraParamsAllowed
} from "swap-layer/assets/SwapLayerRedeem.sol";

import "./SLTSwapBase.sol";
import { nextRn, xPercentOfTheTime } from "./SLTBase.sol";

contract RedeemTest is SLTSwapBase, SwapLayerIntegrationBase {
  using BytesParsing for bytes;
  using Messages for Messages.Fill;
  using { toUniversalAddress } for address;

  function _swapLayer() override internal view returns (ISwapLayer) {
    return ISwapLayer(payable(address(swapLayer)));
  }

  struct RedeemStackVars {
    uint usdcAmount;
    uint userBalanceBeforeEth;
    uint userBalanceBeforeMock;
    uint userBalanceBeforeUsdc;
    uint feeRecipientBalanceBeforeUsdc;
    uint32 deadline;
    uint128 minOutputAmount;
    uint8 swapCount;
    uint8 swapType;
    RedeemMode redeemMode;
    bytes redeemParams;
    uint gasDropoff;
    uint relayingFee;
    bytes redeemPayload;
    bool withOverride;
    bool invalidMsgValue;
    uint msgValue;
    address sender;
    bytes swap;
    bytes swapMessage;
    address outputToken;
    uint outputAmount;
    uint paidRelayingFee;
  }

  /// forge-config: default.fuzz.runs = 10000
  function testRedeemFullFuzz(uint rngSeed_) public {
    uint[] memory rngSeed = new uint[](1);
    rngSeed[0] = rngSeed_;
    unchecked { rngSeed[0] += block.timestamp; }
    RedeemStackVars memory vars;
    //limit to 1 million to avoid exceeding Circle's minterAllowance
    uint maxUsdc = BASE_AMOUNT * USDC;
    uint minUsdc = USDC / 100; //at least 1 cent to avoid degenerate cases
    vars.usdcAmount = nextRn(rngSeed) % (maxUsdc - minUsdc) + minUsdc;
    (, vars.swapCount, vars.swapType, vars.deadline, vars.minOutputAmount, vars.swap) =
      _fuzzEvmOutputParams(rngSeed);

    if (xPercentOfTheTime(33, rngSeed)) {
      vars.redeemMode = RedeemMode.Direct;
      vars.redeemParams = new bytes(0);
    }
    else if (xPercentOfTheTime(50, rngSeed)) {
      vars.redeemMode = RedeemMode.Relay;
      GasDropoff gd;
      if (xPercentOfTheTime(50, rngSeed))
        gd = GasDropoffLib.to(nextRn(rngSeed) % 10 ether);

      vars.gasDropoff = gd.from();
      vars.relayingFee = vars.usdcAmount * (nextRn(rngSeed) % 1e6) / 1e6;
      vars.redeemParams = abi.encodePacked(gd, uint48(vars.relayingFee));
    }
    else {
      vars.redeemMode = RedeemMode.Payload;
      uint payloadLen = nextRn(rngSeed) % (_maxRedeemPayloadLen() + 1);
      uint[] memory pl = new uint[](payloadLen/32 + 1);
      for (uint i = 0; i < pl.length; ++i)
        pl[i] = nextRn(rngSeed);

      (vars.redeemPayload,) = abi.encodePacked(pl).sliceUnchecked(0, payloadLen);
      vars.redeemParams = abi.encodePacked(
        user.toUniversalAddress(),
        uint16(vars.redeemPayload.length),
        vars.redeemPayload
      );
    }

    vars.swapMessage = encodeSwapMessage(
      user.toUniversalAddress(),
      vars.redeemMode,
      vars.redeemParams,
      vars.swap
    );

    vars.userBalanceBeforeEth  = user.balance;
    vars.userBalanceBeforeMock = mockToken.balanceOf(user);
    vars.userBalanceBeforeUsdc = usdc.balanceOf(user);
    vars.feeRecipientBalanceBeforeUsdc = usdc.balanceOf(feeRecipient);

    bytes memory attestation = _attestation(vars.usdcAmount, vars.swapMessage);
    vars.withOverride = xPercentOfTheTime(vars.redeemMode == RedeemMode.Relay ? 1 : 20, rngSeed);
    ComposedRedeemParams memory composedParams;
    if (vars.withOverride) {
      (, vars.swapCount, vars.swapType, vars.deadline, vars.minOutputAmount, vars.swap) =
        _fuzzEvmOutputParams(rngSeed);
      composedParams = _swapLayerComposeRedeem(RedeemOverride(attestation, vars.swap));
    }
    else
      composedParams = _swapLayerComposeRedeem(Redeem(attestation));

    vars.sender = xPercentOfTheTime(25, rngSeed) ? user : address(this);

    vars.invalidMsgValue = xPercentOfTheTime(2, rngSeed);
    if (vars.invalidMsgValue) {
      vars.msgValue = uint48(nextRn(rngSeed));
      vm.deal(vars.sender, vars.msgValue);
      if (vars.msgValue == vars.gasDropoff)
        ++vars.msgValue;
    }
    else
      vars.msgValue = vars.sender == user ? 0 : vars.gasDropoff;

    console.log("timestamp: %d", block.timestamp);
    console.log("usdcAmount: %d", vars.usdcAmount);
    console.log("deadline: %d", vars.deadline);
    console.log("minOutputAmount: %d", vars.minOutputAmount);
    console.log("swapCount: %d", vars.swapCount);
    console.log("swapType: %d", vars.swapType);
    console.log("redeemMode: %d", uint8(vars.redeemMode));
    console.log("gasDropoff: %d", vars.gasDropoff);
    console.log("relayingFee: %d", vars.relayingFee);
    console.log("redeemPayloadLength: %d", vars.redeemPayload.length);
    console.log("withOverride: %d", vars.withOverride);
    console.log("invalidMsgValue: %d", vars.invalidMsgValue);
    console.log("swap");
    console.logBytes(vars.swap);
    console.log("senderIsUser: %d", vars.sender == user);
    // console.log("swapMessage");
    // console.logBytes(vars.swapMessage);
    // console.log("msgValue: %d", vars.msgValue);
    // console.log("userBalanceBeforeEth: %d", vars.userBalanceBeforeEth);
    // console.log("userBalanceBeforeMock: %d", vars.userBalanceBeforeMock);
    // console.log("userBalanceBeforeUsdc: %d", vars.userBalanceBeforeUsdc);
    // console.log("feeRecipientBalanceBeforeUsdc: %d", vars.feeRecipientBalanceBeforeUsdc);
    vm.prank(vars.sender);
    (bool success, bytes memory returnData) = address(swapLayer).call{value: vars.msgValue}(
      abi.encodeCall(
        swapLayer.redeem, (
          AttestationType.LiquidityLayer,
          composedParams.attestation,
          composedParams.params
        )
      )
    );

    bytes memory expectedError;
    if (vars.redeemMode == RedeemMode.Payload && vars.sender != user)
      expectedError =
        abi.encodePacked(
          SenderNotRecipient.selector,
          vars.sender.toUniversalAddress(),
          user.toUniversalAddress()
        );
    else if (vars.sender != user && vars.withOverride)
      expectedError = abi.encodePacked(NoExtraParamsAllowed.selector);
    else if (vars.invalidMsgValue)
      expectedError =
        abi.encodePacked(
          InvalidMsgValue.selector,
          vars.msgValue,
          vars.sender == user ? 0 : vars.gasDropoff
        );

    if (expectedError.length > 0) {
      assertFalse(success, "Call should fail");
      assertEq(returnData, expectedError, "expected error");
      return;
    }

    assertTrue(success, "Call should succeed");
    returnData = abi.decode(returnData, (bytes));

    if (vars.redeemMode == RedeemMode.Relay && vars.sender != user) {
      assertEq(
        usdc.balanceOf(feeRecipient),
        vars.feeRecipientBalanceBeforeUsdc + vars.relayingFee,
        "fee recipient balance"
      );
      vars.paidRelayingFee = vars.relayingFee;
    }
    else
      assertEq(
        usdc.balanceOf(feeRecipient),
        vars.feeRecipientBalanceBeforeUsdc,
        "fee recipient balance"
      );

    if (vars.redeemMode == RedeemMode.Payload) {
      bytes32 sender;
      bytes memory returnedPayload;
      (vars.outputToken, vars.outputAmount, sender, returnedPayload) =
        _swapLayerDecodeRedeemWithPayload(returnData);

      assertEq(sender, user.toUniversalAddress(), "sender");
      assertEq(returnedPayload, vars.redeemPayload, "redeemPayload");
    }
    else
      (vars.outputToken, vars.outputAmount) = _swapLayerDecodeRedeem(returnData);

    uint expectedUserBalanceAfterEthMin = vars.userBalanceBeforeEth + vars.msgValue;
    if (vars.swapCount == 0 ||
        (vars.deadline != 0 && vars.deadline < block.timestamp) ||
        vars.minOutputAmount == type(uint128).max
    ) {
      assertEq(vars.outputToken, address(usdc), "outputToken is not usdc");
      uint expectedOutputAmount = vars.usdcAmount - vars.paidRelayingFee;
      assertEq(vars.outputAmount, expectedOutputAmount);
      assertEq(usdc.balanceOf(user), vars.userBalanceBeforeUsdc + expectedOutputAmount);
      assertEq(user.balance, expectedUserBalanceAfterEthMin);
      assertEq(mockToken.balanceOf(user), vars.userBalanceBeforeMock);
    }
    else if (vars.swapCount == 1) {
      assertEq(vars.outputToken, address(mockToken), "outputToken is not mockToken");
      assertGt(vars.outputAmount, 0);
      assertGt(mockToken.balanceOf(user) + 1, vars.minOutputAmount);
      assertEq(usdc.balanceOf(user), vars.userBalanceBeforeUsdc);
      assertEq(user.balance, expectedUserBalanceAfterEthMin);
    }
    else {
      assertEq(vars.outputToken, address(0), "outputToken is not native token");
      assertGt(vars.outputAmount + 1, vars.minOutputAmount);
      assertGt(user.balance + 1, vars.userBalanceBeforeEth + vars.minOutputAmount + vars.msgValue);
      assertEq(mockToken.balanceOf(user), vars.userBalanceBeforeMock);
      assertEq(usdc.balanceOf(user), vars.userBalanceBeforeUsdc);
    }
  }

  function _attestation(uint amount, bytes memory swapMessage) private returns (bytes memory) {
    Messages.Fill memory fill = Messages.Fill({
      sourceChain: FOREIGN_CHAIN_ID,
      orderSender: FOREIGN_SWAP_LAYER,
      redeemer: address(swapLayer).toUniversalAddress(),
      redeemerMessage: swapMessage
    });

    (bytes memory encodedVaa, bytes memory encodedCctpMessage, bytes memory cctpAttestation) =
      wormholeCctpSimulator.craftWormholeCctpRedeemParams(amount, fill.encode());

    return abi.encode(OrderResponse(encodedVaa, encodedCctpMessage, cctpAttestation));
  }
}
