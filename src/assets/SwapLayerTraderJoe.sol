// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "./SwapLayerBase.sol";
import "./Params.sol";

struct Path {
  uint256[] pairBinSteps;
  uint8[] versions;
  address[] tokenPath;
}

interface TraderJoeLBRouter {
  //selector = 2a443fae
  //  swapExactTokensForTokens(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)
  function swapExactTokensForTokens(
    uint256 amountIn,
    uint256 amountOutMin,
    Path memory path,
    address to,
    uint256 deadline
  ) external returns (uint256 amountOut);

  function swapTokensForExactTokens(
    uint256 amountOut,
    uint256 amountInMax,
    Path memory path,
    address to,
    uint256 deadline
  ) external returns (uint256[] memory amountsIn);
}

abstract contract SwapLayerTraderJoe is SwapLayerBase {
  using BytesParsing for bytes;

  function _traderJoeInitialApprove() internal override {
    _maxApprove(_usdc, _traderJoeRouter);
    _maxApprove(IERC20(address(_wnative)), _traderJoeRouter);
  }

  function _traderJoeSwap(
    bool isExactIn,
    uint inputAmount,
    uint outputAmount,
    IERC20 inputToken,
    IERC20, //outputToken
    bool revertOnFailure,
    bool approveCheck,
    bytes memory path
  ) internal override returns (uint /*inOutAmount*/) { unchecked {
    if ( approveCheck &&
         inputToken.allowance(address(this), _traderJoeRouter) < inputAmount)
      _maxApprove(inputToken, _traderJoeRouter);

    uint pathLength = (path.length - ADDRESS_SIZE) / SHARED_PATH_ELEMENT_SIZE;
    Path memory tjPath = Path(
      new uint256[](pathLength),
      new uint8[](pathLength),
      new address[](pathLength + 1)
    );

    uint offset = 0;
    for (uint i = 0; i < pathLength; ++i) {
      (tjPath.tokenPath[i],    offset) = path.asAddressUnchecked(offset);
      (tjPath.versions[i],     offset) = path.asUint8Unchecked(offset);
      (tjPath.pairBinSteps[i], offset) = path.asUint16Unchecked(offset);
    }
    (tjPath.tokenPath[pathLength],) = path.asAddressUnchecked(offset);
    //we already checked the correctness of the length of path upon the initial parse

    bytes memory funcCall =
      isExactIn
      ? abi.encodeCall(
        TraderJoeLBRouter.swapExactTokensForTokens,
        (inputAmount, outputAmount, tjPath, address(this), block.timestamp)
      )
      : abi.encodeCall(
        TraderJoeLBRouter.swapTokensForExactTokens,
        (outputAmount, inputAmount, tjPath, address(this), block.timestamp)
      );

    (bool success, bytes memory result) = _traderJoeRouter.call(funcCall);
    if (!success) {
      if (revertOnFailure)
        revert SwapFailed(result);
      else
        return 0;
    }

    return isExactIn
      ? abi.decode(result, (uint256))
      : abi.decode(result, (uint256[]))[0];
  }
}}