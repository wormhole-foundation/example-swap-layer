// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

//TODO remove
import {console2 as console} from "forge-std/console2.sol";

import { WormholeCctpMessages } from "wormhole-sdk/libraries/WormholeCctpMessages.sol";
import { toUniversalAddress } from "wormhole-sdk/Utils.sol";
import { WormholeOverride, PublishedMessage } from "wormhole-sdk/testing/WormholeOverride.sol";
import { Messages as LiquidityLayerMessages } from "liquidity-layer/shared/Messages.sol";
import { SwapMessageStructure, parseSwapMessageStructure } from "swap-layer/assets/Message.sol";
import { FeeUpdate, RelayingDisabledForChain } from "swap-layer/assets/SwapLayerRelayingFees.sol";

import "swap-layer/SwapLayerIntegrationBase.sol";

import "./SLTSwapBase.sol";

contract InitiateTest is SLTSwapBase, SwapLayerIntegrationBase {
  using BytesParsing for bytes;
  using WormholeOverride for IWormhole;
  using { toUniversalAddress } for address;

  uint256 private _wormholeMsgFee_;

  function _swapLayer() internal override view returns (ISwapLayer) {
    return ISwapLayer(payable(address(swapLayer)));
  }

  //override here to avoid external calls
  function _swapLayerWormhole() internal override view returns (address) {
    return address(wormhole);
  }

  function _swapLayerUsdc() internal override view returns (address) {
    return address(usdc);
  }

  function _swapLayerWrappedNative() internal override view returns (address) {
    return address(wnative);
  }

  function _wormholeMsgFee() internal override view returns (uint256) {
    return _wormholeMsgFee_;
  }

  function _setUp2() internal override {
    _wormholeMsgFee_ = IWormhole(_swapLayerWormhole()).messageFee();
  }

  function testInitiateDirectUsdc() public {
    uint amount = USER_AMOUNT * USDC;
    _dealOverride(address(usdc), user, amount);
    vm.startPrank(user);
    usdc.approve(address(swapLayer), amount);

    vm.recordLogs();

    assertEq(usdc.balanceOf(address(swapLayer)), 0);
    (uint amountOut, , ) = _swapLayerInitiate(InitiateUsdc({
      targetParams: TargetParams(FOREIGN_CHAIN_ID, recipient.toUniversalAddress()),
      amount: amount,
      outputParams: _swapLayerEncodeOutputParamsUsdc()
    }));
    assertEq(amountOut, amount);
    assertEq(usdc.balanceOf(user), 0);
    assertEq(usdc.balanceOf(address(swapLayer)), 0);

    PublishedMessage[] memory pubMsgs = wormhole.fetchPublishedMessages(vm.getRecordedLogs());
    assertEq(pubMsgs.length, 1);
    (SwapMessageStructure memory sms, bytes memory swapMessage) =
      _decodeAndCheckDepositMessage(pubMsgs[0], amount);

    assertEq(uint8(sms.redeemMode), uint8(RedeemMode.Direct));
    assertEq(sms.payload.length, 0);
    (IoToken outputToken, uint offset) = parseIoToken(swapMessage, sms.swapOffset);
    assertEq(uint8(outputToken), uint8(IoToken.Usdc));
    assertEq(offset, swapMessage.length);
  }

  function testPausedRelay() public {
    vm.prank(assistant);
    swapLayer.batchFeeUpdates(abi.encodePacked(
      FOREIGN_CHAIN_ID,
      FeeUpdate.BaseFee,
      uint32(type(uint32).max)
    ));

    uint amount = USER_AMOUNT * USDC;
    _dealOverride(address(usdc), user, amount);
    vm.startPrank(user);
    usdc.approve(address(swapLayer), amount);

    (bool success, bytes memory errorData) = _swapLayerInitiateRaw(_swapLayerComposeInitiate(
      InitiateRelayUsdc({
        targetParams: TargetParams(FOREIGN_CHAIN_ID, recipient.toUniversalAddress()),
        relayParams: RelayParams({gasDropoffWei: 0, maxRelayerFeeUsdc: amount/10 }),
        amount: amount,
        isExactIn: true,
        outputParams: _swapLayerEncodeOutputParamsUsdc()
      })
    ));
    assertEq(success, false);
    assertEq(errorData.length, 4);
    (bytes4 errorSelector, ) = errorData.asBytes4Unchecked(0);
    assertEq(errorSelector, RelayingDisabledForChain.selector);
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
        maxRelayerFeeUsdc: 10 * USDC
      }),
      amount: USER_AMOUNT * 1 ether,
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

  function _decodeAndCheckDepositMessage(
    PublishedMessage memory pubMsg,
    uint amount
  ) internal view returns (SwapMessageStructure memory sms, bytes memory swapMessage) {
    (
      bytes32 token,
      uint256 cctpAmount,
      , //uint32 sourceCctpDomain,
      , //uint32 targetCctpDomain,
      , //uint64 cctpNonce,
      , //bytes32 burnSource,
      bytes32 mintRecipient,
      bytes memory payload
    ) = WormholeCctpMessages.decodeDeposit(pubMsg.payload);

    assertEq(token, address(usdc).toUniversalAddress());
    assertEq(cctpAmount, amount);
    assertEq(mintRecipient, FOREIGN_LIQUIDITY_LAYER);

    LiquidityLayerMessages.Fill memory fill = LiquidityLayerMessages.decodeFill(payload);
    assertEq(fill.orderSender, address(swapLayer).toUniversalAddress());
    assertEq(fill.redeemer, FOREIGN_SWAP_LAYER);

    swapMessage = fill.redeemerMessage;
    sms = parseSwapMessageStructure(swapMessage);

    assertEq(sms.recipient, recipient);
  }
}
