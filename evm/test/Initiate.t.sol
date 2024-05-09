// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

//TODO remove
import {console2 as console} from "forge-std/console2.sol";

import { WormholeCctpMessages } from "wormhole-sdk/libraries/WormholeCctpMessages.sol";
import { toUniversalAddress } from "wormhole-sdk/Utils.sol";
import { WormholeOverride, PublishedMessage } from "wormhole-sdk/testing/WormholeOverride.sol";
import { Messages as LiquidityLayerMessages } from "liquidity-layer/shared/Messages.sol";
import { SwapMessageStructure, parseSwapMessageStructure } from "swap-layer/assets/Message.sol";

import "swap-layer/SwapLayerIntegrationBase.sol";

import "./SLTSwapBase.sol";

contract InitiateTest is SLTSwapBase, SwapLayerIntegrationBase {
  using BytesParsing for bytes;
  using WormholeOverride for IWormhole;
  using { toUniversalAddress } for address;

  function _swapLayer() override internal view returns (ISwapLayer) {
    return ISwapLayer(payable(address(swapLayer)));
  }

  function testInitiateDirectUsdc() public {
    uint amount = USER_AMOUNT * 1e6;
    bytes32 recipient = user.toUniversalAddress();
    _dealOverride(address(usdc), user, amount);
    vm.startPrank(user);
    usdc.approve(address(swapLayer), amount);

    vm.recordLogs();

    (uint amountOut, , ) = _swapLayerInitiate(InitiateUsdc({
      targetParams: TargetParams(FOREIGN_CHAIN_ID, recipient),
      amount: amount,
      outputParams: _swapLayerEncodeOutputParamsUsdc()
    }));
    assertEq(amountOut, amount);
    assertEq(usdc.balanceOf(user), 0);

    PublishedMessage[] memory pubMsgs = wormhole.fetchPublishedMessages(vm.getRecordedLogs());
    assertEq(pubMsgs.length, 1);
    (
      bytes32 token,
      uint256 cctpAmount,
      , //uint32 sourceCctpDomain,
      , //uint32 targetCctpDomain,
      , //uint64 cctpNonce,
      , //bytes32 burnSource,
      bytes32 mintRecipient,
      bytes memory payload
    ) = WormholeCctpMessages.decodeDeposit(pubMsgs[0].payload);

    assertEq(token, address(usdc).toUniversalAddress());
    assertEq(cctpAmount, amount);
    assertEq(mintRecipient, FOREIGN_LIQUIDITY_LAYER);

    LiquidityLayerMessages.Fill memory fill = LiquidityLayerMessages.decodeFill(payload);
    assertEq(fill.orderSender, address(swapLayer).toUniversalAddress());
    assertEq(fill.redeemer, FOREIGN_SWAP_LAYER);
    SwapMessageStructure memory swapMessageStructure =
      parseSwapMessageStructure(fill.redeemerMessage);

    assertEq(swapMessageStructure.recipient, user);
    assertEq(uint8(swapMessageStructure.redeemMode), uint8(RedeemMode.Direct));
    assertEq(swapMessageStructure.payload.length, 0);
    (IoToken outputToken, ) = parseIoToken(fill.redeemerMessage, swapMessageStructure.swapOffset);
    assertEq(uint8(outputToken), uint8(IoToken.Usdc));
  }

  function testPausedRelay() public {

  }

  function testInitiateTraderJoeEthSwap() public {
    hoax(user);
    (uint amountOut, , ) = _swapLayerInitiate(InitiateNative({
      targetParams: TargetParams(
        FOREIGN_CHAIN_ID,
        user.toUniversalAddress()
      ),
      amount: USER_AMOUNT * 1e18,
      isExactIn: true,
      evmSwapParams: EvmSwapParams({
        swapDeadline: _deadline(),
        limitAmount: 0,
        swapType: EvmSwapType.TraderJoe,
        path: abi.encodePacked(
          TRADERJOE_VERSION,
          TRADERJOE_BIN_STEP,
          address(mockToken),
          TRADERJOE_VERSION,
          TRADERJOE_BIN_STEP
        )
      }),
      outputParams: _swapLayerEncodeOutputParamsUsdc()
    }));

    assertTrue(amountOut > 0);
  }

  function testInitiateUniswapEthSwapRelayed() public {
    hoax(user);
    (uint amountOut, , , uint relayerFee) = _swapLayerInitiate(InitiateRelayNative({
      targetParams: TargetParams(
        FOREIGN_CHAIN_ID,
        user.toUniversalAddress()
      ),
      relayParams: RelayParams({
        gasDropoffWei: 0,
        maxRelayerFeeUsdc: 1e9
      }),
      amount: USER_AMOUNT * 1e18,
      isExactIn: true,
      evmSwapParams: EvmSwapParams({
        swapDeadline: _deadline(),
        limitAmount: 0,
        swapType: EvmSwapType.UniswapV3,
        path: abi.encodePacked(
          UNISWAP_FEE,
          address(mockToken),
          UNISWAP_FEE
        )
      }),
      outputParams: _swapLayerEncodeOutputParamsUsdc()
    }));

    assertTrue(amountOut > 0);
    assertTrue(relayerFee > 0);
  }
}
