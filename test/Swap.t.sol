// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import { MockERC20 } from "forge-std/mocks/MockERC20.sol";
import { StdUtils } from "forge-std/StdUtils.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IWETH } from "wormhole/interfaces/IWETH.sol";
import { BytesParsing } from "wormhole/libraries/BytesParsing.sol";
import { toUniversalAddress } from "wormhole/Utils.sol";

import { SwapLayerTestBase } from "./TestBase.sol";
import { INonfungiblePositionManager } from "./INonfungiblePositionManager.sol";

import { Messages } from "./liquidity-layer/shared/Messages.sol";

import "swap-layer/assets/SwapLayerInitiate.sol";
import "swap-layer/assets/SwapLayerRedeem.sol";
import "swap-layer/assets/SwapLayerQuery.sol";

contract SwapLayerSwapTest is SwapLayerTestBase {
  using BytesParsing for bytes;
  using Messages for Messages.Fill;
  using { toUniversalAddress } for address;

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
      vm.envAddress("TEST_UNISWAP_V3_POSITION_MANAGER_ADDRESS")
    );
    (user, userSecret) = makeAddrAndKey("user");
  }

  function setUp() public {
    deployBase();

    (address weth_, ) = swapLayer.batchQueries(abi.encodePacked(
      QueryType.Immutable, ImmutableType.Weth
    )).asAddressUnchecked(0);
    weth = IWETH(weth_);
    mockToken = StdUtils.deployMockERC20("MockToken", "MOCK", 18);

    //.5 eth = 1 mockToken
    uint pool0wethAmount      = BASE_AMOUNT * 5e17;
    uint pool0mockTokenAmount = BASE_AMOUNT * 1e18;
    //1 mockToken = 5 usdc => 1 eth = 10 usdc
    uint pool1mockTokenAmount = BASE_AMOUNT * 1e18;
    uint pool1usdcAmount      = BASE_AMOUNT * 5e6;

    _dealUsdc(address(this), pool1usdcAmount);
    deal(address(mockToken), address(this), pool0mockTokenAmount + pool1mockTokenAmount);
    weth.deposit{value: pool0wethAmount}();

    _createPool(address(weth),      pool0wethAmount,      address(mockToken), pool0mockTokenAmount);
    _createPool(address(mockToken), pool1mockTokenAmount, address(usdc),      pool1usdcAmount);
  }

  function _createPool(address tokenA, uint amountA, address tokenB,  uint amountB) internal {
    (address token0, uint amount0, address token1, uint amount1) = tokenA < tokenB
      ? (tokenA, amountA, tokenB, amountB)
      : (tokenB, amountB, tokenA, amountA);
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
      amount0Desired: amount0,
      amount1Desired: amount1,
      amount0Min: 0,
      amount1Min: 0,
      recipient: address(this),
      deadline: block.timestamp + 1800
    }));
  }

  function testDirectUsdc() public {
    uint amount = USER_AMOUNT * 1e6;
    _dealUsdc(user, amount);
    vm.startPrank(user);
    usdc.approve(address(swapLayer), amount);
    bytes memory swapReturn = swapLayer.initiate(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        false,           //fast transfer
        RedeemMode.Direct,
        IoToken.Usdc,    //output token
        true,            //isExactIn
        IoToken.Usdc,    //input token
        uint128(amount), //input amount
        AcquireMode.Preapproved
      )
    );
    (uint amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertEq(amount, amountOut);
    vm.stopPrank();
  }

  function testEthSwap() public {
    hoax(user);
    bytes memory swapReturn = swapLayer.initiate{value: USER_AMOUNT * 1e18}(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        FastTransferMode.Disabled,
        RedeemMode.Direct,
        IoToken.Usdc, //output token
        true,         //isExactIn
        IoToken.Gas,  //input token
        SwapType.UniswapV3,
        uint128(0),   //minOutputAmount
        uint32(block.timestamp + 1800), //deadline
        UNISWAP_FEE,
        uint8(1),     //pathLength
        address(mockToken),
        UNISWAP_FEE
      )
    );
    (uint256 amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertTrue(amountOut > 0);
  }

  function testBasicRedeem() public {
    uint usdcAmount = USER_AMOUNT * 1e6;
    bytes memory redeemParams;
    bytes memory swapMessage = encodeSwapMessage(
      user.toUniversalAddress(),
      abi.encodePacked(RedeemMode.Direct),
      abi.encodePacked(IoToken.Usdc)
    );
    bytes memory redeemReturn = redeem(usdcAmount, redeemParams, swapMessage);
    (address outputToken, uint outputAmount) = abi.decode(redeemReturn, (address, uint));
    assertEq(outputToken, address(usdc));
    assertEq(outputAmount, usdcAmount);
  }

  function testRedeemEthSwap() public {
    uint usdcAmount = USER_AMOUNT * 1e6;
    bytes memory redeemParams;
    bytes memory swapMessage = encodeSwapMessage(
      user.toUniversalAddress(),
      abi.encodePacked(RedeemMode.Direct),
      abi.encodePacked(
        IoToken.Gas,
        SwapType.UniswapV3,
        uint128(0), //minOutputAmount
        uint32(0),  //deadline
        UNISWAP_FEE,
        uint8(1),   //pathLength
        address(mockToken),
        UNISWAP_FEE
      )
    );

    uint balanceBefore = user.balance;
    bytes memory redeemReturn = redeem(usdcAmount, redeemParams, swapMessage);
    uint ethReceived = user.balance - balanceBefore;

    (address outputToken, uint outputAmount) = abi.decode(redeemReturn, (address, uint));
    assertEq(outputToken, address(0));
    assertEq(outputAmount, ethReceived);
    assertTrue(ethReceived > 0);
  }

  function redeem(
    uint amount,
    bytes memory redeemParams,
    bytes memory swapMessage
  ) private returns (bytes memory) {
    Messages.Fill memory fill = Messages.Fill({
      sourceChain: FOREIGN_CHAIN_ID,
      orderSender: FOREIGN_SWAP_LAYER,
      redeemer: address(swapLayer).toUniversalAddress(),
      redeemerMessage: swapMessage
    });

    (bytes memory encodedVaa, bytes memory encodedCctpMessage, bytes memory cctpAttestation) =
      cctpOverride.craftWormholeCctpRedeemParams(amount, fill.encode());

    return swapLayer.redeem(
      redeemParams,
      Attestations(encodedVaa, encodedCctpMessage, cctpAttestation)
    );
  }
}