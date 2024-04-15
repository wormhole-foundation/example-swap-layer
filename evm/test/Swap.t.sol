// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { MockERC20 } from "forge-std/mocks/MockERC20.sol";
import { StdUtils } from "forge-std/StdUtils.sol";
import { IERC20 } from "@openzeppelin/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/utils/math/Math.sol";

import "wormhole-sdk/libraries/BytesParsing.sol";
import { toUniversalAddress } from "wormhole-sdk/Utils.sol";

import { SwapLayerTestBase } from "./TestBase.sol";
import { INonfungiblePositionManager } from "./external/IUniswap.sol";
import { ITJLBRouter, ITJLBFactory } from "./external/ITraderJoe.sol";
import { PriceHelper as TJMath } from "./external/TJMath/PriceHelper.sol";

import { Messages } from "./liquidity-layer/shared/Messages.sol";

import "swap-layer/assets/Params.sol";
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
  uint8 constant TRADERJOE_VERSION = 2;
  //only 25, 50, and 100 are open on Mainnet Ethereum
  //  see here: https://etherscan.io/address/0xDC8d77b69155c7E68A95a4fb0f06a71FF90B943a#readContract#F12
  uint16 constant TRADERJOE_BIN_STEP = 25; //size of a bin = 1 + .0001*binStep

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
  ) internal pure returns (PoolParams memory) {
    (address token0, uint amount0, address token1, uint amount1) = tokenA < tokenB
      ? (tokenA, amountA, tokenB, amountB)
      : (tokenB, amountB, tokenA, amountA);

    return PoolParams(token0, amount0, token1, amount1);
  }

  function setUp() public {
    deployBase();

    mockToken = StdUtils.deployMockERC20("MockToken", "MOCK", 18);

    PoolParams[] memory pools = new PoolParams[](2);
    //.5 eth = 1 mockToken
    pools[0] = _makePoolParams(
      address(wnative),
      BASE_AMOUNT * 5e17,
      address(mockToken),
      BASE_AMOUNT * 1e18
    );
    //1 mockToken = 5 usdc => 1 eth = 10 usdc
    pools[1] = _makePoolParams(
      address(mockToken),
      BASE_AMOUNT * 1e18,
      address(usdc),
      BASE_AMOUNT * 5e6
    );

    for (uint i = 0; i < pools.length; ++i) {
      _dealOverride(pools[i].token0, address(this), 2 * pools[i].amount0);
      _dealOverride(pools[i].token1, address(this), 2 * pools[i].amount1);
      _deployUniswapPool(pools[i].token0, pools[i].amount0, pools[i].token1, pools[i].amount1);
      _deployTJLBPool(pools[i].token0, pools[i].amount0, pools[i].token1, pools[i].amount1);
    }
  }

  function _deployUniswapPool(address token0, uint amount0, address token1, uint amount1) internal {
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

  function _deployTJLBPool(address token0, uint amount0, address token1, uint amount1) internal {
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
        deadline: block.timestamp + 1800
      }));

    assertEq(amount0Added, amount0);
    assertEq(amount1Added, amount1);
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
        true,            //isExactIn
        IoToken.Usdc,    //input token
        uint128(amount), //input amount
        AcquireMode.Preapproved,
        IoToken.Usdc    //output token
      )
    );
    (uint amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertEq(amount, amountOut);
    vm.stopPrank();
  }

  function testInitiateUniswapEthSwap() public {
    hoax(user);
    bytes memory swapReturn = swapLayer.initiate{value: USER_AMOUNT * 1e18}(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        FastTransferMode.Disabled,
        RedeemMode.Direct,
        true,         //isExactIn
        IoToken.Gas,  //input token
        uint32(block.timestamp + 1800), //deadline
        uint128(0),   //minOutputAmount
        uint8(SWAP_TYPE_UNISWAPV3),
        UNISWAP_FEE,
        uint8(1),     //pathLength
        address(mockToken),
        UNISWAP_FEE,
        IoToken.Usdc //output token
      )
    );
    (uint256 amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertTrue(amountOut > 0);
  }

  function testInitiateTraderJoeEthSwap() public {
    hoax(user);
    bytes memory swapReturn = swapLayer.initiate{value: USER_AMOUNT * 1e18}(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        FastTransferMode.Disabled,
        RedeemMode.Direct,
        true,         //isExactIn
        IoToken.Gas,  //input token
        uint32(block.timestamp + 1800), //deadline
        uint128(0),   //minOutputAmount
        uint8(SWAP_TYPE_TRADERJOE),
        TRADERJOE_VERSION,
        TRADERJOE_BIN_STEP,
        uint8(1),     //pathLength
        address(mockToken),
        TRADERJOE_VERSION,
        TRADERJOE_BIN_STEP,
        IoToken.Usdc //output token
      )
    );
    (uint256 amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertTrue(amountOut > 0);
  }

  function testInitiateUniswapEthSwapRelayed() public {
    hoax(user);
    bytes memory swapReturn = swapLayer.initiate{value: USER_AMOUNT * 1e18}(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        FastTransferMode.Disabled,
        RedeemMode.Relay,
        uint32(0),    //gas dropoff
        uint48(1e9),  //max relayer fee
        true,         //isExactIn
        IoToken.Gas,  //input token
        uint32(block.timestamp + 1800), //deadline
        uint128(0),   //minOutputAmount
        uint8(SWAP_TYPE_UNISWAPV3),
        UNISWAP_FEE,
        uint8(1),     //pathLength
        address(mockToken),
        UNISWAP_FEE,
        IoToken.Usdc //output token
      )
    );
    (uint256 amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertTrue(amountOut > 0);
  }

  function testDirectRedeem() public {
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

  function testRedeemUniswapEthSwap() public {
    uint usdcAmount = USER_AMOUNT * 1e6;
    bytes memory redeemParams;
    bytes memory swapMessage = encodeSwapMessage(
      user.toUniversalAddress(),
      abi.encodePacked(RedeemMode.Direct),
      abi.encodePacked(
        IoToken.Gas,
        uint32(0),  //deadline
        uint128(0), //minOutputAmount
        uint8(SWAP_TYPE_UNISWAPV3),
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
      wormholeCctpSimulator.craftWormholeCctpRedeemParams(amount, fill.encode());

    return swapLayer.redeem(
      redeemParams,
      Attestations(encodedVaa, encodedCctpMessage, cctpAttestation)
    );
  }
}