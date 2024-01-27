// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import { MockERC20 } from "forge-std/mocks/MockERC20.sol";
import { StdUtils } from "forge-std/StdUtils.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { BytesParsing } from "wormhole/libraries/BytesParsing.sol";
import { toUniversalAddress } from "wormhole/Utils.sol";

import { SwapLayerTestBase } from "./TestBase.sol";
import { INonfungiblePositionManager } from "./external/INonfungiblePositionManager.sol";

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
  //chose so that with additional 18 decimals it still fits in a uint64, which allows us to
  //  calculate the  price via uint160(Math.sqrt((amount1 << 192) / amount0));
  uint constant BASE_AMOUNT = 10;
  uint constant USER_AMOUNT = 1;

  INonfungiblePositionManager immutable uniswapPosMan;
  address immutable user;
  uint256 immutable userSecret;

  MockERC20 mockToken;

  constructor() {
    uniswapPosMan = INonfungiblePositionManager(
      vm.envAddress("TEST_UNISWAP_V3_POSITION_MANAGER_ADDRESS")
    );
    (user, userSecret) = makeAddrAndKey("user");
  }

  struct Pool {
    address token0;
    uint amount0;
    address token1;
    uint amount1;
  }

  function setUp() public {
    deployBase();

    mockToken = StdUtils.deployMockERC20("MockToken", "MOCK", 18);

    Pool[] memory pools = new Pool[](2);
      //.5 eth = 1 mockToken
    pools[0] = Pool(address(wnative),   BASE_AMOUNT * 5e17, address(mockToken), BASE_AMOUNT * 1e18);
      //1 mockToken = 5 usdc => 1 eth = 10 usdc
    pools[1] = Pool(address(mockToken), BASE_AMOUNT * 1e18, address(usdc),      BASE_AMOUNT * 5e6);

    for (uint i = 0; i < pools.length; ++i)
      _deployUniswapPool(pools[i].token0, pools[i].amount0, pools[i].token1, pools[i].amount1);
  }

  function _deployUniswapPool(address tokenA, uint amountA, address tokenB, uint amountB) internal {
    (address token0, uint amount0, address token1, uint amount1) = tokenA < tokenB
      ? (tokenA, amountA, tokenB, amountB)
      : (tokenB, amountB, tokenA, amountA);
    _dealOverride(token0, address(this), amount0);
    _dealOverride(token1, address(this), amount1);
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

  function _deployTJLBPool(address tokenA, uint amountA, address tokenB, uint amountB) internal {

  }

  // ---------------- Tests ----------------

  function testInitiateDirectUsdc() public {
    uint amount = USER_AMOUNT * 1e6;
    _dealOverride(address(usdc), user, amount);
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

  function testInitiateEthSwap() public {
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
        uint32(block.timestamp + 1800), //deadline
        uint128(0),   //minOutputAmount
        SwapType.UniswapV3,
        UNISWAP_FEE,
        uint8(1),     //pathLength
        address(mockToken),
        UNISWAP_FEE
      )
    );
    (uint256 amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertTrue(amountOut > 0);
  }

  function testInitiateRelayedEthSwap() public {
    hoax(user);
    bytes memory swapReturn = swapLayer.initiate{value: USER_AMOUNT * 1e18}(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        FastTransferMode.Disabled,
        RedeemMode.Relay,
        uint32(0),    //gas dropoff
        uint48(1e9),  //max relayer fee
        IoToken.Usdc, //output token
        true,         //isExactIn
        IoToken.Gas,  //input token
        uint32(block.timestamp + 1800), //deadline
        uint128(0),   //minOutputAmount
        SwapType.UniswapV3,
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
    bytes memory redeemReturn = _redeem(usdcAmount, redeemParams, swapMessage);
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
        uint32(0),  //deadline
        uint128(0), //minOutputAmount
        SwapType.UniswapV3,
        UNISWAP_FEE,
        uint8(1),   //pathLength
        address(mockToken),
        UNISWAP_FEE
      )
    );

    uint balanceBefore = user.balance;
    bytes memory redeemReturn = _redeem(usdcAmount, redeemParams, swapMessage);
    uint ethReceived = user.balance - balanceBefore;

    (address outputToken, uint outputAmount) = abi.decode(redeemReturn, (address, uint));
    assertEq(outputToken, address(0));
    assertEq(outputAmount, ethReceived);
    assertTrue(ethReceived > 0);
  }

  function _redeem(
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