// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "@openzeppelin/token/ERC20/IERC20.sol";
import "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

import "wormhole-sdk/interfaces/IWormhole.sol";
import "permit2/interfaces/IPermit2.sol";

import {IWETH} from "wormhole-sdk/interfaces/token/IWETH.sol";
import "wormhole-sdk/libraries/BytesParsing.sol";
import {ITokenRouter} from "liquidity-layer/interfaces/ITokenRouter.sol";
import {SWAP_TYPE_UNISWAPV3, SWAP_TYPE_TRADERJOE, parseIERC20} from "./Params.sol";

struct SwapLayerPeersState {
  // chainId => wormhole address mapping of swap contracts on other chains
  mapping(uint16 => bytes32) peers;
}

// keccak256("SwapLayerPeersState") - 1
bytes32 constant SWAP_LAYER_ENDPOINTS_STORAGE_SLOT =
  0xb61590eff329af7624aa29325e2f4a6630b27f49b074313bf2beeaaebd805731;

function swapLayerPeersState() pure returns (SwapLayerPeersState storage state) {
  assembly ("memory-safe") {
    state.slot := SWAP_LAYER_ENDPOINTS_STORAGE_SLOT
  }
}

error InvalidSwapType(uint256 swapType);
error SwapFailed(bytes reason);
error InvalidChainId();
error DeadlineExpired(uint256 blocktime, uint256 deadline);
error EthTransferFailed();

abstract contract SwapLayerBase {
  using BytesParsing for bytes;

  ITokenRouter internal immutable _liquidityLayer;
  IPermit2     internal immutable _permit2;
  IWETH        internal immutable _wnative;
  IWormhole    internal immutable _wormhole;
  IERC20       internal immutable _usdc;
  uint16       internal immutable _chainId;
  address      internal immutable _uniswapRouter;
  address      internal immutable _traderJoeRouter;

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

  function batchMaxApprove(bytes calldata approvals) external {
    uint offset = 0;
    while (offset < approvals.length) {
      IERC20 token;
      (token, offset) = parseIERC20(approvals, offset);
      _uniswapMaxApprove(token);
      _traderJoeMaxApprove(token);
    }
    approvals.checkLength(offset);
  }

  function _maxApprove(IERC20 token, address spender) internal {
    SafeERC20.forceApprove(token, spender, type(uint256).max);
  }

  //the semantic equivalent of a `default: assert(false)` case in a switch statement
  //  used in if/else cascades that model switch statements that must be exhaustive
  //  uses assert() because it can only be reached if there's a bug in the code
  function _assertExhaustive() internal pure {
    assert(false);
  }

  function _getPeer(uint16 chainId) internal view returns (bytes32) {
    return swapLayerPeersState().peers[chainId];
  }

  function _setPeer(uint16 peerChain, bytes32 peer) internal {
    if (peerChain == 0 || peerChain == _chainId)
      revert InvalidChainId();

    swapLayerPeersState().peers[peerChain] = peer;
  }

  function _transferEth(address to, uint256 amount) internal {
    (bool success, ) = to.call{value: amount}(new bytes(0));
    if (!success)
      revert EthTransferFailed();
  }

  //returns the consumed input amount on exact out swaps and the output amount on exact in swaps
  //revertOnFailure guarantees that the caller will either receive the requested output token with
  //  within the specified limits, or the call will revert.
  function _swap(
    uint swapType,
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

    function(bool,uint,uint,IERC20,IERC20,bool,bool,bytes memory) internal returns (uint) swapFunc;
    if (swapType == SWAP_TYPE_UNISWAPV3)
      swapFunc = _uniswapSwap;
    else if (swapType == SWAP_TYPE_TRADERJOE)
      swapFunc = _traderJoeSwap;
    else if (revertOnFailure)
      revert InvalidSwapType(swapType);
    else
      //invalid swaps are ignored when not reverting on failure to avoid funds getting stuck
      return 0;

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

  function _uniswapMaxApprove(IERC20 token) internal virtual;

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

  function _traderJoeMaxApprove(IERC20 token) internal virtual;

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
