// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

//import { ISwapRouter } from "uniswap/ISwapRouter.sol";
import { IPermit2 } from "permit2/IPermit2.sol";
import { IWormhole } from "wormhole/interfaces/IWormhole.sol";
import { IWETH } from "wormhole/interfaces/IWETH.sol";
import { BytesParsing } from "wormhole/libraries/BytesParsing.sol";
import { ITokenRouter } from "liquidity-layer/ITokenRouter.sol";

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
error DeadlineExpired(uint256 blocktime, uint256 deadline);

abstract contract SwapLayerBase {
  using BytesParsing for bytes;
  using SafeERC20 for IERC20;

  ITokenRouter     internal immutable _liquidityLayer;
  IWormhole        internal immutable _wormhole;
  IERC20           internal immutable _usdc;
  IWETH            internal immutable _weth;
  IPermit2         internal immutable _permit2;
  //ISwapRouter    internal immutable _uniV3Router;
  IUniversalRouter internal immutable _universalRouter;
  uint16           internal immutable _chainId;

  constructor(
    address weth,
    address permit2,
    address universalRouter,
    address liquidityLayer
  ) {
    _liquidityLayer  = ITokenRouter(liquidityLayer);
    _wormhole        = IWormhole(_liquidityLayer.wormhole());
    _usdc            = IERC20(_liquidityLayer.orderToken());
    _weth            = IWETH(weth);
    //_weth          = IWETH(uniV3Router.WETH9());
    _permit2         = IPermit2(permit2);
    _universalRouter = IUniversalRouter(universalRouter);
    _chainId         = _wormhole.chainId();
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

  function _permit2MaxApprove(address token) internal {
    _permit2.approve(token, address(_universalRouter), type(uint160).max, type(uint48).max);
  }

  //returns the consumed input amount on exact out swaps and the output amount on exact in swaps
  function _swap(
    bool isExactIn,
    uint inputAmount,
    uint outputAmount,
    IERC20 inputToken,
    IERC20 outputToken,
    bool revertOnFailure,
    bool approveCheck,
    uint256 deadline,
    bytes memory path
  ) internal returns (uint /*inOutAmount*/) { unchecked {
    if (deadline != 0 && deadline < block.timestamp) {
      if (revertOnFailure)
        revert DeadlineExpired(block.timestamp, deadline);
      else
        return 0;
    }
    
    // if ( approveCheck && 
    //      inputToken.allowance(address(this), address(_uniV3Router)) < inputAmount)
    //   _maxApprove(inputToken, address(_uniV3Router));
    if (approveCheck) {
      (uint allowance,, ) = 
        _permit2.allowance(address(this), address(inputToken), address(_universalRouter));
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
 
    //previous uniswap v3 periphery swap router code:
    // if (isExactIn) {
    //   try _uniV3Router.exactInput(
    //     ISwapRouter.ExactInputParams(path, address(this), deadline, inputAmount, outputAmount)
    //   ) returns (uint256 amountOut) {
    //     return amountOut;
    //   } catch Error(string memory reason) {
    //     if (revertOnFailure)
    //       revert(reason);
    //     else
    //       return 0;
    //   }
    // } else {
    //   try _uniV3Router.exactOutput(
    //     ISwapRouter.ExactOutputParams(path, address(this), deadline, inputAmount, outputAmount)
    //   ) returns (uint256 amountIn) {
    //     return amountIn;
    //   } catch Error(string memory reason) {
    //     if (revertOnFailure)
    //       revert(reason);
    //     else
    //       return 0;
    //   }
    // }
  }}

  function _universalRouterSwap(
    uint8 command,
    IERC20 unknownBalanceToken,
    uint256 inOutAmount,
    uint256 limitAmount,
    bytes memory path,
    bool revertOnFailure
  ) private returns (uint /*balanceBefore*/, uint /*balanceAfter*/) {
    bytes[] memory inputs = new bytes[](1);
    inputs[0] = abi.encode(address(this), inOutAmount, limitAmount, path, true);
    uint balanceBefore = unknownBalanceToken.balanceOf(address(this));
    try _universalRouter.execute(abi.encodePacked(command), inputs) {
      uint balanceAfter = unknownBalanceToken.balanceOf(address(this));
      return (balanceBefore, balanceAfter);
    } catch Error(string memory reason) {
      if (revertOnFailure)
        revert(reason);
      else
        return (0, 0);
    }
  }
}
