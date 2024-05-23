// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "./SwapLayerBase.sol";

struct SwapParams {
  bytes path;
  address recipient;
  uint256 deadline;
  uint256 inOutAmount;
  uint256 limitAmount;
}

interface IUniswapV3SwapRouter {
  function exactInput(SwapParams calldata params) external payable returns (uint256 amountOut);
  function exactOutput(SwapParams calldata params) external payable returns (uint256 amountIn);
}

abstract contract SwapLayerUniswapV3R is SwapLayerBase {
  function _uniswapMaxApprove(IERC20 token) internal override {
    if (_uniswapRouter == address(0))
      return;

    _maxApprove(token, _uniswapRouter);
  }

  function _uniswapSwap(
    bool isExactIn,
    uint inputAmount,
    uint outputAmount,
    IERC20 inputToken,
    IERC20, //outputToken
    bool revertOnFailure,
    bool approveCheck,
    bytes memory path
  ) internal override returns (uint /*inOutAmount*/) {
    if (approveCheck && inputToken.allowance(address(this), _uniswapRouter) < inputAmount)
      _maxApprove(inputToken, _uniswapRouter);

    SwapParams memory swapParams =
      SwapParams(path, address(this), block.timestamp, inputAmount, outputAmount);

    bytes memory funcCall = abi.encodeWithSelector(
      isExactIn
      ? IUniswapV3SwapRouter.exactInput.selector
      : IUniswapV3SwapRouter.exactOutput.selector,
      (swapParams)
    );

    (bool success, bytes memory result) = _uniswapRouter.call(funcCall);
    if (!success) {
      if (revertOnFailure)
        revert SwapFailed(result);
      else
        return 0;
    }

    return abi.decode(result, (uint256));
  }
}