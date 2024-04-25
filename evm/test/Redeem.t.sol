// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { toUniversalAddress } from "wormhole-sdk/Utils.sol";

import { Messages } from "liquidity-layer/shared/Messages.sol";

import "swap-layer/assets/SwapLayerRedeem.sol";
import { encodeSwapMessage } from "swap-layer/assets/Message.sol";

import "./SwapBase.sol";

contract SwapLayerRedeemTest is SwapLayerSwapBase {
  using BytesParsing for bytes;
  using Messages for Messages.Fill;
  using { toUniversalAddress } for address;

  function testRedeemDirect() public {
    uint usdcAmount = USER_AMOUNT * 1e6;
    bytes memory redeemParams;
    bytes memory swapMessage = encodeSwapMessage(
      user.toUniversalAddress(),
      abi.encodePacked(RedeemMode.Direct),
      abi.encodePacked(IoToken.Usdc)
    );
    bytes memory redeemReturn = _redeem(usdcAmount, redeemParams, swapMessage);
    (address outputToken, uint outputAmount) = abi.decode(redeemReturn, (address, uint));
    assertEq(outputToken, address(usdc));
    assertEq(outputAmount, usdcAmount);
  }

  function testRedeemUniswapEthSwap() public {
    uint usdcAmount = USER_AMOUNT * 1e6;
    bytes memory redeemParams;
    bytes memory swapMessage = encodeSwapMessage(
      user.toUniversalAddress(),
      abi.encodePacked(RedeemMode.Direct),
      abi.encodePacked(
        IoToken.Gas,
        uint32(0),  //deadline
        uint128(0), //minOutputAmount
        uint8(SWAP_TYPE_UNISWAPV3),
        UNISWAP_FEE,
        uint8(1),   //pathLength
        address(mockToken),
        UNISWAP_FEE
      )
    );

    uint balanceBefore = user.balance;
    bytes memory redeemReturn = _redeem(usdcAmount, redeemParams, swapMessage);
    uint ethReceived = user.balance - balanceBefore;

    (address outputToken, uint outputAmount) = abi.decode(redeemReturn, (address, uint));
    assertEq(outputToken, address(0));
    assertEq(outputAmount, ethReceived);
    assertTrue(ethReceived > 0);
  }

  function _redeem(
    uint amount,
    bytes memory redeemParams,
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

    return swapLayer.redeem(
      redeemParams,
      Attestations(encodedVaa, encodedCctpMessage, cctpAttestation)
    );
  }
}
