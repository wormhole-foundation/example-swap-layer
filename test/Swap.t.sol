// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import { MockERC20 } from "forge-std/mocks/MockERC20.sol";
import { StdUtils } from "forge-std/StdUtils.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IWETH } from "wormhole/IWETH.sol";
import { BytesParsing } from "wormhole/WormholeBytesParsing.sol";
import { toUniversalAddress } from "wormhole/Utils.sol";

import { SwapLayerTestBase } from "./TestBase.sol";
import { INonfungiblePositionManager } from "./INonfungiblePositionManager.sol";

import "swap-layer/assets/SwapLayerInitiate.sol";
import "swap-layer/assets/SwapLayerRedeem.sol";
import "swap-layer/assets/SwapLayerBatchGet.sol";

contract SwapLayerSwapTest is SwapLayerTestBase {
  using BytesParsing for bytes;

  uint24 constant UNISWAP_FEE = 500;
  //int24 constant UNISWAP_MAX_TICK = 887272;
  int24 constant UNISWAP_MAX_TICK = 887270;
  uint constant BASE_AMOUNT = 10; //with additional 18 decimals fits in a uint64
  uint constant USER_AMOUNT = 1;

  INonfungiblePositionManager immutable uniswapPosMan;
  address immutable user;
  uint256 immutable userSecret;

  IWETH weth;
  MockERC20 mockToken;

  constructor() {
    uniswapPosMan = INonfungiblePositionManager(
      vm.envAddress("TEST_UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ADDRESS")
    );
    (user, userSecret) = makeAddrAndKey("user");
    deal(address(usdc), user, USER_AMOUNT * 1e6);
  }

  function setUp() public {
    deployBase();

    (address weth_, ) = swapLayer.batchGet(abi.encodePacked(QueryType.Weth)).asAddressUnchecked(0);
    weth = IWETH(weth_);
    mockToken = StdUtils.deployMockERC20("MockToken", "MOCK", 18);
    deal(address(usdc), address(this), BASE_AMOUNT * 1e6);
    deal(address(mockToken), address(this), 2 * BASE_AMOUNT * 1e18);
    weth.deposit{value: BASE_AMOUNT * 1e18}();
    _createPool(address(weth), address(mockToken), BASE_AMOUNT * 1e18, BASE_AMOUNT * 1e18);
    _createPool(address(mockToken), address(usdc), BASE_AMOUNT * 1e18, BASE_AMOUNT * 1e6);
  }

  function _createPool(address tokenA, address tokenB, uint amountA, uint amountB) internal {
    (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    (uint amount0, uint amount1) = tokenA < tokenB ? (amountA, amountB) : (amountB, amountA);
    uint160 sqrtPriceX96 = uint160(Math.sqrt((amount1 << 192) / amount0));
    uniswapPosMan.createAndInitializePoolIfNecessary(token0, token1, UNISWAP_FEE, sqrtPriceX96);
    IERC20(token0).approve(address(uniswapPosMan), amount0);
    IERC20(token1).approve(address(uniswapPosMan), amount1);
    uniswapPosMan.mint(INonfungiblePositionManager.MintParams({
      token0: token0,
      token1: token1,
      fee: UNISWAP_FEE,
      tickLower: -UNISWAP_MAX_TICK,
      tickUpper: UNISWAP_MAX_TICK,
      amount0Desired: amountA,
      amount1Desired: amountB,
      amount0Min: 0,
      amount1Min: 0,
      recipient: address(this),
      deadline: block.timestamp + 1800
    }));
  }

  function testDirectUsdc() public {
    uint amount = USER_AMOUNT * 1e6;
    vm.startPrank(user);
    usdc.approve(address(swapLayer), amount);
    bytes memory swapReturn = swapLayer.initiate(
      foreignChainId,
      toUniversalAddress(user),
      true,
      abi.encodePacked(
        FastTransferMode.Disabled,
        RedeemMode.Direct,
        IoToken.Usdc, //output token
        IoToken.Usdc, //input token
        uint128(amount), //input amount
        AcquireMode.Preapproved
      )
    );
    (uint amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertEq(amount, amountOut);
    vm.stopPrank();
  }
  
  // function testEthSwap() public {
  //   hoax(user);
  //   bytes memory swapReturn = swapLayer.initiate{value: USER_AMOUNT * 1e18}(
  //     foreignChainId,
  //     toUniversalAddress(user),
  //     true,
  //     abi.encodePacked(
  //       uint8(FastTransferMode.Disabled),
  //       RedeemMode.Direct,
  //       IoToken.Usdc, //output token
  //       IoToken.Gas, //input token
  //       true, //approveCheck
  //       uint128(0), //minOutputAmount
  //       uint32(block.timestamp + 1800), //deadline
  //       UNISWAP_FEE,
  //       uint8(1), //pathLength
  //       address(mockToken),
  //       UNISWAP_FEE
  //     )
  //   );
  //   (uint256 amountOut, ) = swapReturn.asUint256Unchecked(0);
  //   assertTrue(amountOut > 0);
  // }
}