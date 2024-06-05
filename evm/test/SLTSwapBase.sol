// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { MockERC20 } from "forge-std/mocks/MockERC20.sol";
import { StdUtils } from "forge-std/StdUtils.sol";
import { IERC20 } from "@openzeppelin/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/utils/math/Math.sol";

import "wormhole-sdk/libraries/BytesParsing.sol";
import { toUniversalAddress } from "wormhole-sdk/Utils.sol";

import { SLTBase, nextRn, xPercentOfTheTime } from "./SLTBase.sol";
import { INonfungiblePositionManager } from "./external/IUniswap.sol";
import { ITJLBRouter, ITJLBFactory } from "./external/ITraderJoe.sol";
import { PriceHelper as TJMath } from "./external/TJMath/PriceHelper.sol";

import "swap-layer/assets/Params.sol";
import "swap-layer/assets/SwapLayerQuery.sol";

contract SLTSwapBase is SLTBase {
  using BytesParsing for bytes;
  using { toUniversalAddress } for address;

  uint24 constant UNISWAP_FEE = 500;
  //int24 constant UNISWAP_MAX_TICK = 887272;
  int24  constant UNISWAP_MAX_TICK = 887270;
  uint8  constant TRADERJOE_VERSION = 2;
  //only 25, 50, and 100 are open on Mainnet Ethereum
  //  see here: https://etherscan.io/address/0xDC8d77b69155c7E68A95a4fb0f06a71FF90B943a#readContract#F12
  uint16 constant TRADERJOE_BIN_STEP = 25; //size of a bin = 1 + .0001*binStep

  uint   constant BASE_AMOUNT = 1e6;
  uint   constant USER_AMOUNT = 1;
  uint8  constant MOCK_TOKEN_DECIMALS = 18;

  uint   constant USDC_PER_MOCK_TOKEN = 5; //1 mockToken = 5 usdc
  uint   constant MOCK_TOKEN_PER_ETH = 2; //.5 eth = 1 mockToken
  uint   constant USDC_PER_ETH = USDC_PER_MOCK_TOKEN * MOCK_TOKEN_PER_ETH; //=> 1 eth = 10 usdc


  INonfungiblePositionManager immutable uniswapPosMan;
  address immutable user;
  uint256 immutable userSecret;
  address immutable recipient;

  MockERC20 mockToken;

  constructor() {
    uniswapPosMan = INonfungiblePositionManager(
      vm.envAddress("TEST_UNISWAP_V3_POSITION_MANAGER_ADDRESS")
    );
    (user, userSecret) = makeAddrAndKey("user");
    recipient = makeAddr("recipient");
  }

  function _tokenToMultiplier(IoToken token) internal pure returns (uint) {
    if (token == IoToken.Wire)
      return USDC;
    if (token == IoToken.Gas)
      return 1 ether;
    return 10 ** MOCK_TOKEN_DECIMALS;
  }

  function _convertAmount(IoToken from, uint amount, IoToken to) internal pure returns (uint) {
    if (from == to)
      return amount;

    uint numerator = _tokenToMultiplier(to);
    uint denominator = _tokenToMultiplier(from);
    if (from == IoToken.Gas && to == IoToken.Wire)
      denominator /= USDC_PER_ETH;
    else if (from == IoToken.Wire && to == IoToken.Gas)
      numerator /= USDC_PER_ETH;
    else if (from == IoToken.Other && to == IoToken.Wire)
      denominator /= USDC_PER_MOCK_TOKEN;
    else if (from == IoToken.Wire && to == IoToken.Other)
      numerator /= USDC_PER_MOCK_TOKEN;
    else if (from == IoToken.Gas && to == IoToken.Other)
      denominator /= MOCK_TOKEN_PER_ETH;
    else //(from == IoToken.Other && to == IoToken.Gas)
      numerator /= MOCK_TOKEN_PER_ETH;

    return amount * numerator / denominator;
  }

  function _maxRedeemPayloadLen() internal view returns (uint) {
    return liquidityLayer.getMaxPayloadSize() / 2;
  }

  function _validDeadline() internal view returns (uint) {
    return block.timestamp + 1800;
  }

  function _fuzzIoToken(uint[] memory rngSeed) internal pure returns (IoToken) {
    if (xPercentOfTheTime(33, rngSeed))
      return IoToken.Wire;

    if (xPercentOfTheTime(50, rngSeed))
      return IoToken.Gas;

    return IoToken.Other;
  }

  function _fuzzDeadline(
    uint invalidFrequenzy,
    uint[] memory rngSeed
  ) internal view returns (uint32 deadline) {
    bool deadlineExpired = xPercentOfTheTime(invalidFrequenzy, rngSeed);
    deadline = uint32(
      deadlineExpired
      ? (nextRn(rngSeed) % (block.timestamp-2)) + 1
      : (xPercentOfTheTime(50, rngSeed) ? _validDeadline() : 0)
    );
  }

  function _fuzzEvmSwapType(uint[] memory rngSeed) internal pure returns (uint8 swapType) {
    swapType = xPercentOfTheTime(50, rngSeed) ? SWAP_TYPE_UNISWAPV3 : SWAP_TYPE_TRADERJOE;
  }

  function _evmSwapTypeToPoolId(uint8 swapType) internal pure returns (uint24) {
    return swapType == SWAP_TYPE_UNISWAPV3
      ? UNISWAP_FEE
      : uint24((uint(TRADERJOE_VERSION) << TRADERJOE_BINSTEP_SIZE*8) + TRADERJOE_BIN_STEP);
  }

  function _fuzzEvmOutputParams(uint[] memory rngSeed) internal view returns (
    IoToken outputToken,
    uint8 swapCount,
    uint8 swapType,
    uint32 deadline,
    uint128 minOutputAmount,
    bytes memory encodedSwap
  ) {
    outputToken = _fuzzIoToken(rngSeed);
    if (outputToken != IoToken.Wire) {
      (swapCount, swapType, deadline, minOutputAmount, encodedSwap) =
        _fuzzEvmOutputSwap(outputToken, rngSeed);
    }
    else
      encodedSwap = new bytes(0);

    encodedSwap = abi.encodePacked(outputToken, encodedSwap);
  }

  function _fuzzEvmOutputSwap(IoToken outputToken, uint[] memory rngSeed) internal view returns (
    uint8 swapCount,
    uint8 swapType,
    uint32 deadline,
    uint128 minOutputAmount,
    bytes memory encodedSwap
  ) {
    deadline = _fuzzDeadline(20, rngSeed);
    bool slippageExceeded = xPercentOfTheTime(20, rngSeed);
    minOutputAmount = slippageExceeded ? type(uint128).max : 0;
    swapType = _fuzzEvmSwapType(rngSeed);
    uint24 poolId = _evmSwapTypeToPoolId(swapType);
    bytes memory sharedSwapParams = abi.encodePacked(deadline, minOutputAmount, swapType, poolId);
    swapCount = outputToken == IoToken.Other ? 1 : 2;
    encodedSwap = outputToken == IoToken.Other
      ? abi.encodePacked(address(mockToken).toUniversalAddress(), sharedSwapParams, swapCount-1)
      : abi.encodePacked(sharedSwapParams, swapCount-1, address(mockToken), poolId);
  }

  function _setUp2() internal virtual { }

  function _setUp1() internal override {
    mockToken = StdUtils.deployMockERC20("MockToken", "MOCK", MOCK_TOKEN_DECIMALS);

    PoolParams[] memory pools = new PoolParams[](2);
    pools[0] = _makePoolParams(
      address(wnative),
      BASE_AMOUNT * 1 ether / MOCK_TOKEN_PER_ETH,
      address(mockToken),
      BASE_AMOUNT * 10 ** MOCK_TOKEN_DECIMALS
    );
    pools[1] = _makePoolParams(
      address(mockToken),
      BASE_AMOUNT * 10 ** MOCK_TOKEN_DECIMALS,
      address(usdc),
      BASE_AMOUNT * USDC_PER_MOCK_TOKEN * USDC
    );

    for (uint i = 0; i < pools.length; ++i) {
      _dealOverride(pools[i].token0, address(this), 2 * pools[i].amount0);
      _dealOverride(pools[i].token1, address(this), 2 * pools[i].amount1);
      _deployUniswapPool(pools[i].token0, pools[i].amount0, pools[i].token1, pools[i].amount1);
      _deployTJLBPool(pools[i].token0, pools[i].amount0, pools[i].token1, pools[i].amount1);
    }

    _setUp2();
  }

  struct PoolParams {
    address token0;
    uint amount0;
    address token1;
    uint amount1;
  }

  function _makePoolParams(
    address tokenA,
    uint amountA,
    address tokenB,
    uint amountB
  ) private pure returns (PoolParams memory) {
    (address token0, uint amount0, address token1, uint amount1) = tokenA < tokenB
      ? (tokenA, amountA, tokenB, amountB)
      : (tokenB, amountB, tokenA, amountA);

    return PoolParams(token0, amount0, token1, amount1);
  }

  function _deployUniswapPool(address token0, uint amount0, address token1, uint amount1) private {
    require(amount1 <= type(uint128).max, "excessive pool balance");
    uint160 sqrtPriceX96 = uint160(
      amount1 <= type(uint64).max
      ? Math.sqrt((amount1 << 192) / amount0)
      : Math.sqrt((amount1 << 128) / amount0) << 32
    );
    uniswapPosMan.createAndInitializePoolIfNecessary(token0, token1, UNISWAP_FEE, sqrtPriceX96);
    IERC20(token0).approve(address(uniswapPosMan), amount0);
    IERC20(token1).approve(address(uniswapPosMan), amount1);
    uniswapPosMan.mint(INonfungiblePositionManager.MintParams({
      token0: token0,
      token1: token1,
      fee: UNISWAP_FEE,
      tickLower: -UNISWAP_MAX_TICK,
      tickUpper: UNISWAP_MAX_TICK,
      amount0Desired: amount0,
      amount1Desired: amount1,
      amount0Min: 0,
      amount1Min: 0,
      recipient: address(this),
      deadline: _validDeadline()
    }));
  }

  function _deployTJLBPool(address token0, uint amount0, address token1, uint amount1) private {
    require(amount1 <= type(uint128).max, "excessive pool balance");
    uint256 price128x128 = (amount1 << 128) / amount0;
    uint24 activeId = TJMath.getIdFromPrice(price128x128, TRADERJOE_BIN_STEP);

    ITJLBFactory factory = ITJLBRouter(traderJoeRouter).getFactory();

    if (!factory.isQuoteAsset(token0)) {
      vm.prank(factory.owner());
      factory.addQuoteAsset(token0);
    }

    if (!factory.isQuoteAsset(token1)) {
      vm.prank(factory.owner());
      factory.addQuoteAsset(token1);
    }

    ITJLBRouter(traderJoeRouter).createLBPair(token0, token1, activeId, TRADERJOE_BIN_STEP);

    uint tailWidth = 2;
    uint binCount = tailWidth*2 + 1; //2 tails + center bin -> 5 bins
    int256[] memory deltaIds = new int256[](binCount);
    uint256[] memory distributionX = new uint256[](binCount);
    uint256[] memory distributionY = new uint256[](binCount);
    distributionY[0] = 40e16;
    distributionY[1] = 40e16;
    distributionY[2] = 20e16; distributionX[2] = 20e16;
    distributionX[3] = 40e16;
    distributionX[4] = 40e16;

    IERC20(token0).approve(traderJoeRouter, amount0);
    IERC20(token1).approve(traderJoeRouter, amount1);

    (uint amount0Added, uint amount1Added,,,,) =
      ITJLBRouter(traderJoeRouter).addLiquidity(ITJLBRouter.LiquidityParameters({
        tokenX: token0,
        tokenY: token1,
        binStep: TRADERJOE_BIN_STEP,
        amountX: amount0,
        amountY: amount1,
        amountXMin: 0,
        amountYMin: 0,
        activeIdDesired: activeId,
        idSlippage: 1,
        deltaIds: deltaIds,
        distributionX: distributionX,
        distributionY: distributionY,
        to: address(this),
        refundTo: address(this),
        deadline: _validDeadline()
      }));

    assertEq(amount0Added, amount0);
    assertEq(amount1Added, amount1);
  }
}
