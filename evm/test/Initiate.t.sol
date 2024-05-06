// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { toUniversalAddress } from "wormhole-sdk/Utils.sol";

import "swap-layer/SwapLayerIntegrationBase.sol";

import "./SLTSwapBase.sol";

contract InitiateTest is SLTSwapBase, SwapLayerIntegrationBase {
  using BytesParsing for bytes;
  using { toUniversalAddress } for address;

  function _swapLayer() override internal view returns (ISwapLayer) {
    return ISwapLayer(payable(address(swapLayer)));
  }

  function testInitiateDirectUsdc() public {
    uint amount = USER_AMOUNT * 1e6;
    _dealOverride(address(usdc), user, amount);
    vm.startPrank(user);
    usdc.approve(address(swapLayer), amount);
    (uint amountOut, , ) = _swapLayerInitiate(InitiateUsdc(
      TargetParams(
        FOREIGN_CHAIN_ID,
        user.toUniversalAddress()
      ),
      amount,
      _swapLayerEncodeOutputParamsUsdc()
    ));
    assertEq(amount, amountOut);
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
