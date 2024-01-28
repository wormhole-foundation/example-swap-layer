// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IPermit2 } from "permit2/IPermit2.sol";
import { IWormhole } from "wormhole-sdk/interfaces/IWormhole.sol";
import { IWETH } from "wormhole-sdk/interfaces/IWETH.sol";
import { BytesParsing } from "wormhole-sdk/libraries/BytesParsing.sol";
import { ITokenRouter } from "liquidity-layer/ITokenRouter.sol";
import { SwapType } from "./Params.sol";

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

error SwapFailed(bytes reason);
error InvalidChainId();
error DeadlineExpired(uint256 blocktime, uint256 deadline);
error EthTransferFailed();

abstract contract SwapLayerBase {
  using BytesParsing for bytes;

  ITokenRouter     internal immutable _liquidityLayer;
  IPermit2         internal immutable _permit2;
  IWETH            internal immutable _wnative;
  IWormhole        internal immutable _wormhole;
  IERC20           internal immutable _usdc;
  uint16           internal immutable _chainId;
  address          internal immutable _uniswapRouter;
  address          internal immutable _traderJoeRouter;

  constructor(
    address liquidityLayer,
    address permit2,
    address wnative,
    address uniswapRouter,
    address traderJoeRouter
  ) {
    _liquidityLayer  = ITokenRouter(liquidityLayer);
    _permit2         = IPermit2(permit2);
    _wnative         = IWETH(wnative);
    _wormhole        = IWormhole(_liquidityLayer.wormhole());
    _usdc            = IERC20(_liquidityLayer.orderToken());
    _chainId         = _wormhole.chainId();
    _uniswapRouter   = uniswapRouter;
    _traderJoeRouter = traderJoeRouter;
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
    SafeERC20.forceApprove(token, spender, type(uint256).max);
  }

  //returns the consumed input amount on exact out swaps and the output amount on exact in swaps
  function _swap(
    SwapType swapType,
    bool isExactIn,
    uint inputAmount,
    uint outputAmount,
    IERC20 inputToken,
    IERC20 outputToken,
    bool revertOnFailure,
    bool approveCheck,
    uint256 deadline,
    bytes memory path
  ) internal returns (uint /*inOutAmount*/) {
    if (deadline != 0 && deadline < block.timestamp) {
      if (revertOnFailure)
        revert DeadlineExpired(block.timestamp, deadline);
      else
        return 0;
    }

    function(bool,uint,uint,IERC20,IERC20,bool,bool,bytes memory) internal returns (uint) swapFunc =
      swapType == SwapType.UniswapV3 ? _uniswapSwap : _traderJoeSwap;

    return swapFunc(
      isExactIn,
      inputAmount,
      outputAmount,
      inputToken,
      outputToken,
      revertOnFailure,
      approveCheck,
      path
    );
  }

  function _uniswapInitialApprove() internal virtual;

  function _uniswapSwap(
    bool isExactIn,
    uint inputAmount,
    uint outputAmount,
    IERC20 inputToken,
    IERC20 outputToken,
    bool revertOnFailure,
    bool approveCheck,
    bytes memory path
  ) virtual internal returns (uint /*inOutAmount*/);

  function _traderJoeInitialApprove() internal virtual;

  function _traderJoeSwap(
    bool isExactIn,
    uint inputAmount,
    uint outputAmount,
    IERC20 inputToken,
    IERC20 outputToken,
    bool revertOnFailure,
    bool approveCheck,
    bytes memory path
  ) virtual internal returns (uint /*inOutAmount*/);
}
