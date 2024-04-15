// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "./SwapLayerBase.sol";

uint8 constant UNIVERSAL_ROUTER_EXACT_IN = 0;
uint8 constant UNIVERSAL_ROUTER_EXACT_OUT = 1;

interface IUniversalRouter {
  //inputs = abi.encode(
  //  address recipient,
  //  uint256 inOutAmount,
  //  uint256 limitAmount,
  //  bytes   path,
  //  boolean payerIsSender - always true
  //)
  function execute(
    bytes calldata commands,
    bytes[] calldata inputs
  ) external payable;
}

abstract contract SwapLayerUniswapUR is SwapLayerBase {
  function _permit2MaxApprove(address token) internal {
    _permit2.approve(token, _uniswapRouter, type(uint160).max, type(uint48).max);
  }

  function _uniswapInitialApprove() internal override {
    //if any of the addresses are null, return
    if (address(_permit2) == address(0) || _uniswapRouter == address(0))
      return;

    _maxApprove(_usdc, address(_permit2));
    _maxApprove(IERC20(address(_wnative)), address(_permit2));
    _permit2MaxApprove(address(_usdc));
    _permit2MaxApprove(address(_wnative));
  }

  function _uniswapSwap(
    bool isExactIn,
    uint inputAmount,
    uint outputAmount,
    IERC20 inputToken,
    IERC20 outputToken,
    bool revertOnFailure,
    bool approveCheck,
    bytes memory path
  ) internal override returns (uint /*inOutAmount*/) {
    if (approveCheck) {
      //universal router always uses permit2 for transfers...
      //see here: https://github.com/Uniswap/universal-router/blob/41183d6eb154f0ab0e74a0e911a5ef9ea51fc4bd/contracts/modules/uniswap/v3/V3SwapRouter.sol#L65
      //and here: https://github.com/Uniswap/universal-router/blob/41183d6eb154f0ab0e74a0e911a5ef9ea51fc4bd/contracts/modules/Permit2Payments.sol#L41
      (uint allowance,, ) =
        _permit2.allowance(address(this), address(inputToken), _uniswapRouter);
      if (allowance < inputAmount)
        _permit2MaxApprove(address(inputToken));
    }

    if (isExactIn) {
      (uint balanceBefore, uint balanceAfter) = _universalRouterSwap(
        UNIVERSAL_ROUTER_EXACT_IN,
        outputToken,
        inputAmount,
        outputAmount,
        path,
        revertOnFailure
      );
      return balanceAfter - balanceBefore;
    }
    else {
      (uint balanceBefore, uint balanceAfter) = _universalRouterSwap(
        UNIVERSAL_ROUTER_EXACT_OUT,
        inputToken,
        outputAmount,
        inputAmount,
        path,
        revertOnFailure
      );
      return balanceBefore - balanceAfter;
    }
  }

  function _universalRouterSwap(
    uint8 command,
    IERC20 unknownBalanceToken,
    uint256 inOutAmount,
    uint256 limitAmount,
    bytes memory path,
    bool revertOnFailure
  ) private returns (uint balanceBefore, uint balanceAfter) {
    bytes[] memory inputs = new bytes[](1);
    inputs[0] = abi.encode(address(this), inOutAmount, limitAmount, path, true);
    bytes memory funcCall =
      abi.encodeCall(IUniversalRouter.execute, (abi.encodePacked(command), inputs));

    balanceBefore = unknownBalanceToken.balanceOf(address(this));
    (bool success, bytes memory result) = _uniswapRouter.call(funcCall);
    if (!success) {
      if (revertOnFailure)
        revert SwapFailed(result);
      else
        balanceBefore = 0; //return (0,0)
    }
    else
      balanceAfter = unknownBalanceToken.balanceOf(address(this));
  }
}