// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ISwapRouter } from "uniswap/ISwapRouter.sol";
import { IPermit2 } from "permit2/IPermit2.sol";
import { IWormhole } from "wormhole/IWormhole.sol";
import { IWETH } from "wormhole/IWETH.sol";
import { BytesParsing } from "wormhole/WormholeBytesParsing.sol";
import { ITokenRouter } from "liquidity-layer/ITokenRouter.sol";

struct SwapLayerEndpointsState {
  // chainId => wormhole address mapping of swap contracts on other chains
  mapping(uint16 => bytes32) endpoints;
}

// keccak256("SwapLayerEndpointsState") - 1
bytes32 constant SWAP_LAYER_ENDPOINTS_STORAGE_SLOT =
  0xb61590eff329af7624aa29325e2f4a6630b27f49b074313bf2beeaaebd805731;

function swapLayerEndpointsState() pure returns (SwapLayerEndpointsState storage state) {
  assembly ("memory-safe") {
    state.slot := SWAP_LAYER_ENDPOINTS_STORAGE_SLOT
  }
}

error EthTransferFailed();
error InvalidChainId();

abstract contract SwapLayerBase {
  using BytesParsing for bytes;
  using SafeERC20 for IERC20;

  IWormhole    internal immutable _wormhole;
  IERC20       internal immutable _usdc;
  IWETH        internal immutable _weth;
  IPermit2     internal immutable _permit2;
  ISwapRouter  internal immutable _uniV3Router;
  ITokenRouter internal immutable _liquidityLayer;
  uint16       internal immutable _chainId;

  constructor(
    IPermit2     permit2,
    ISwapRouter  uniV3Router,
    ITokenRouter liquidityLayer
  ) {
    _wormhole       = liquidityLayer.wormhole();
    _usdc           = IERC20(liquidityLayer.orderToken());
    _weth           = IWETH(uniV3Router.WETH9());
    _permit2        = permit2;
    _uniV3Router    = uniV3Router;
    _liquidityLayer = liquidityLayer;
    _chainId        = _wormhole.chainId();
  }

  function _getEndpoint(uint16 chainId) internal view returns (bytes32) {
    return swapLayerEndpointsState().endpoints[chainId];
  }

  function _setEndpoint(uint16 endpointChain, bytes32 endpoint) internal {
    if (endpointChain == 0 || endpointChain == _chainId)
      revert InvalidChainId();

    swapLayerEndpointsState().endpoints[endpointChain] = endpoint;
  }

  function _transferEth(address to, uint256 amount) internal {
    (bool success, ) = to.call{value: amount}(new bytes(0));
    if (!success)
      revert EthTransferFailed();
  }

  function _maxApprove(IERC20 token, address spender) internal {
    token.forceApprove(spender, type(uint256).max);
  }

  //returns the consumed input amount on exact out swaps and the output amount on exact in swaps
  function _swap(
    bool isExactIn,
    uint inputAmount,
    uint outputAmount,
    IERC20 inputToken,
    bool revertOnFailure,
    bool approveCheck,
    uint256 deadline,
    bytes memory path
  ) internal returns (uint /*inOutAmount*/) {
    if (approveCheck && inputToken.allowance(address(this), address(_uniV3Router)) < inputAmount)
      _maxApprove(inputToken, address(_uniV3Router));

    if (deadline == 0)
      deadline = block.timestamp; //only 2 gas to push the current block timestamp on the stack

    if (isExactIn) {
      try _uniV3Router.exactInput(
        ISwapRouter.ExactInputParams(path, address(this), deadline, inputAmount, outputAmount)
      ) returns (uint256 amountOut) {
        return amountOut;
      } catch Error(string memory reason) {
        if (revertOnFailure)
          revert(reason);
        else
          return 0;
      }
    } else {
      try _uniV3Router.exactOutput(
        ISwapRouter.ExactOutputParams(path, address(this), deadline, inputAmount, outputAmount)
      ) returns (uint256 amountIn) {
        return amountIn;
      } catch Error(string memory reason) {
        if (revertOnFailure)
          revert(reason);
        else
          return 0;
      }
    }
  }
}
