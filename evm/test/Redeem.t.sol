// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { toUniversalAddress } from "wormhole-sdk/Utils.sol";

import { Messages } from "liquidity-layer/shared/Messages.sol";
import { OrderResponse } from "liquidity-layer/interfaces/ITokenRouter.sol";

import "swap-layer/SwapLayerIntegrationBase.sol";
import { encodeSwapMessage } from "swap-layer/assets/Message.sol";

import "./SLTSwapBase.sol";

contract RedeemTest is SLTSwapBase, SwapLayerIntegrationBase {
  using BytesParsing for bytes;
  using Messages for Messages.Fill;
  using { toUniversalAddress } for address;

  function _swapLayer() override internal view returns (ISwapLayer) {
    return ISwapLayer(payable(address(swapLayer)));
  }

  function testRedeemDirect() public {
    uint usdcAmount = USER_AMOUNT * 1e6;
    bytes memory swapMessage = encodeSwapMessage(
      user.toUniversalAddress(),
      abi.encodePacked(RedeemMode.Direct),
      abi.encodePacked(IoToken.Usdc)
    );

    (address outputToken, uint outputAmount) =
      _swapLayerRedeem(Redeem(_attestation(usdcAmount, swapMessage)));

    assertEq(outputToken, address(usdc));
    assertEq(outputAmount, usdcAmount);
    assertEq(outputAmount, usdc.balanceOf(user));
  }

  function testRedeemUniswapEthSwap() public {
    uint usdcAmount = USER_AMOUNT * 1e6;
    bytes memory swapMessage = encodeSwapMessage(
      user.toUniversalAddress(),
      abi.encodePacked(RedeemMode.Direct),
      abi.encodePacked(
        IoToken.Gas,
        uint32(0),  //deadline
        uint128(0), //minOutputAmount
        SWAP_TYPE_UNISWAPV3,
        UNISWAP_FEE,
        uint8(1),   //pathLength
        address(mockToken),
        UNISWAP_FEE
      )
    );

    uint balanceBefore = user.balance;
    (address outputToken, uint outputAmount) =
      _swapLayerRedeem(Redeem(_attestation(usdcAmount, swapMessage)));
    uint ethReceived = user.balance - balanceBefore;

    assertEq(outputToken, address(0));
    assertEq(outputAmount, ethReceived);
    assertTrue(ethReceived > 0);
  }

  function _attestation(
    uint amount,
    bytes memory swapMessage
  ) private returns (bytes memory) {
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
