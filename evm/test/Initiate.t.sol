// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { console2 as console } from "forge-std/console2.sol";

import { WormholeCctpMessages } from "wormhole-sdk/libraries/WormholeCctpMessages.sol";
import { toUniversalAddress } from "wormhole-sdk/Utils.sol";
import { WormholeOverride, PublishedMessage } from "wormhole-sdk/testing/WormholeOverride.sol";
import { Messages as LiquidityLayerMessages } from "liquidity-layer/shared/Messages.sol";
import { SwapMessageStructure, parseSwapMessageStructure } from "swap-layer/assets/Message.sol";
import { SwapFailed, DeadlineExpired } from "swap-layer/assets/SwapLayerBase.sol";
import {
  FeeUpdate,
  ExceedsMaxGasDropoff,
  RelayingDisabledForChain,
  InvalidSwapTypeForChain
} from "swap-layer/assets/SwapLayerRelayingFees.sol";
import { ExceedsMaxRelayingFee, ChainNotSupported } from "swap-layer/assets/SwapLayerInitiate.sol";

import "swap-layer/SwapLayerIntegrationBase.sol";

import "./SLTSwapBase.sol";

contract InitiateTest is SLTSwapBase, SwapLayerIntegrationBase {
  using BytesParsing for bytes;
  using WormholeOverride for IWormhole;
  using { toUniversalAddress } for address;

  uint private constant FAST_FEE_MINIMUM =
    FAST_TRANSFER_BASE_FEE + FAST_TRANSFER_INIT_AUCTION_FEE + 1;

  uint256 private _wormholeMsgFee_;

  function _swapLayer() internal override view returns (ISwapLayer) {
    return ISwapLayer(payable(address(swapLayer)));
  }

  //override here to avoid external calls
  function _swapLayerWormhole() internal override view returns (address) {
    return address(wormhole);
  }

  function _swapLayerUsdc() internal override view returns (address) {
    return address(usdc);
  }

  function _swapLayerWrappedNative() internal override view returns (address) {
    return address(wnative);
  }

  function _wormholeMsgFee() internal override view returns (uint256) {
    return _wormholeMsgFee_;
  }

  function _setUp2() internal override {
    _wormholeMsgFee_ = IWormhole(_swapLayerWormhole()).messageFee();
    vm.prank(user);
    usdc.approve(address(swapLayer), type(uint256).max);
  }

  function _composeInputParams(
    IoToken inputToken,
    uint inputAmount,
    uint outputAmount,
    uint32 deadline,
    uint8 swapType
  ) internal view returns (bytes memory) {
    assert(inputToken != IoToken.Usdc);
    uint24 poolId = _evmSwapTypeToPoolId(swapType);
    return inputToken == IoToken.Other
      ? abi.encodePacked(
          true, //approveCheck
          address(mockToken),
          uint128(inputAmount),
          AcquireMode.Preapproved,
          deadline,
          uint128(outputAmount),
          swapType,
          poolId,
          uint8(0) //pathlength
        )
      : abi.encodePacked(
          deadline,
          uint128(outputAmount),
          swapType,
          poolId,
          uint8(1), //pathlength
          address(mockToken),
          poolId
        );
  }

  function _fundUser(IoToken inputToken) internal {
    if (inputToken == IoToken.Usdc) {
      _dealOverride(address(usdc), user, BASE_AMOUNT * USDC);
      vm.prank(user);
      usdc.approve(address(swapLayer), type(uint128).max);
    }
    else if (inputToken == IoToken.Other) {
      _dealOverride(address(mockToken), user, BASE_AMOUNT * 10 ** MOCK_TOKEN_DECIMALS);
      vm.prank(user);
      mockToken.approve(address(swapLayer), type(uint128).max);
    }
    else
      deal(user, BASE_AMOUNT * 1 ether);
  }

  //TODO replace with a solution that does not rely on the swap layer itself
  error SwapResult(bool success, uint256 consumedInput, uint256 sentUsdc);
  function simulateSwapImpl(
    bool isExactIn,
    IoToken inputToken,
    uint inputAmount,
    uint outputAmount,
    uint8 swapType
  ) external {
    assert(inputToken != IoToken.Usdc);
    _fundUser(inputToken);
    uint balanceBefore;
    if (inputToken == IoToken.Gas)
      balanceBefore = user.balance;
    else
      balanceBefore = mockToken.balanceOf(user);

    vm.prank(user);
    (bool success, bytes memory returnData) = address(swapLayer).call{
      value: _wormholeMsgFee() + (inputToken == IoToken.Gas ? inputAmount : 0)
    }(abi.encodeWithSelector(
      swapLayer.initiate.selector,
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        TransferMode.LiquidityLayer,
        new bytes(0),
        RedeemMode.Direct,
        new bytes(0),
        isExactIn,
        inputToken,
        _composeInputParams(
          inputToken,
          inputAmount,
          outputAmount,
          uint32(_validDeadline()),
          swapType
        ),
        IoToken.Usdc,
        new bytes(0)
      )
    ));
    if (!success)
      revert SwapResult(false, 0, 0);

    uint consumedInput = balanceBefore - (
      inputToken == IoToken.Gas ? user.balance - _wormholeMsgFee() : mockToken.balanceOf(user)
    );
    (uint sendAmountUsdc, ) = abi.decode(returnData, (bytes)).asUint256Unchecked(0);
    revert SwapResult(true, consumedInput, sendAmountUsdc);
  }

  function _simulateSwap(
    bool isExactIn,
    IoToken inputToken,
    uint inputAmount,
    uint outputAmount,
    uint8 swapType
  ) internal returns (bool success, uint consumedInput, uint sentUsdc) {
    (, bytes memory swapResult) = address(this).call(abi.encodeWithSelector(
      this.simulateSwapImpl.selector,
      isExactIn, inputToken, inputAmount, outputAmount, swapType
    ));
    (bytes memory swapResultParams, ) = swapResult.slice(4, swapResult.length-4);
    return abi.decode(swapResultParams, (bool, uint, uint));
  }

  // function testSwap() public {
  //   (bool success, uint consumedInput, uint sentUsdc) =
  //     _simulateSwap(false, IoToken.Gas, 1e6 ether, 1 * USDC, 1);
  //   console.log("success: %d", success);
  //   console.log("consumedInput: %d", consumedInput);
  //   console.log("sentUsdc: %d", sentUsdc);
  //   console.log("usdc: %a", address(usdc));
  //   console.log("weth: %a", address(wnative));
  //   console.log("mock: %a", address(mockToken));
  // }

  struct InitiateStackVars {
    uint   msgValue;
    uint16 targetChain;

    TransferMode transferMode;
    uint   fastTransferMaxFee;
    uint32 auctionDeadline;
    bytes  transferParams;

    RedeemMode redeemMode;
    uint  gasDropoff;
    bool  exceedMaxDropoff;
    uint  maxRelayingFee;
    uint  expectedRelayingFee;
    bytes redeemPayload;
    bytes redeemParams;

    bool isExactIn;

    IoToken inputToken;
    uint    inputAmount;
    uint32  deadline;
    uint128 outputAmount;
    bool    slippageExceeded;
    uint    expectedSentAmount;
    bytes   inputParams;

    bool invalidSwap;
    IoToken outputToken;
    uint8 outputSwapCount;
    uint8 outputSwapType;
    bytes outputParams;

    uint userBalanceBeforeEth;
    uint userBalanceBeforeMock;
    uint userBalanceBeforeUsdc;
    uint feeRecipientBalanceBeforeUsdc;
    uint sequenceBefore;

    uint sentAmount;
  }

  //This full fuzz test is sadly extremely unwieldy. Fuzzing all parameters with reasonable ranges
  //  in a way that the expected result is clear is very tricky due to the interconnected nature
  //  of the various values. For example, the output amount of an exact out swap requires a
  //  sufficient amount of input tokens, which need to be further increased to also cover the
  //  costs of a potential fast transfer and relay. Further, if it is indeed a fast transfer,
  //  the out amount must also exceed the minimum fast transfer amount.
  //To really do a good, readable job with this, one would actually want to declare the full graph
  //  of all interdependency in some declaractive way and leverage that actually generate test cases
  //  but good luck implementing this in Solidity.
  //Additionally, the ordering of the error checks matters too. We'd have to create a list of all
  //  checks that a given test case violates upon generation and then check if the error returned
  //  by the swap layer matches any one of those errors, which is again annoying to implement
  //  with Solidity.
  //Therefore, what we're instead left with is this huge, ugly, hodgepodge of a fuzz test.
  //I'd gladly take pointers how anything here can be substantially improved.

  /// forge-config: default.fuzz.runs = 10000
  function testInitiateFullFuzz(uint rngSeed_) public {
    uint[] memory rngSeed = new uint[](1);
    rngSeed[0] = rngSeed_;
    unchecked { rngSeed[0] += block.timestamp; }
    InitiateStackVars memory vars;

    vars.targetChain = xPercentOfTheTime(75, rngSeed) ? FOREIGN_CHAIN_ID : SOLANA_CHAIN_ID;

    vars.outputToken = _fuzzIoToken(rngSeed);

    if (vars.outputToken != IoToken.Usdc) {
      vars.invalidSwap = xPercentOfTheTime(2, rngSeed);
      if ((vars.targetChain == FOREIGN_CHAIN_ID && !vars.invalidSwap) ||
          (vars.targetChain ==  SOLANA_CHAIN_ID &&  vars.invalidSwap)) {
        (vars.outputSwapCount, vars.outputSwapType, , , vars.outputParams) =
          _fuzzEvmOutputSwap(vars.outputToken, rngSeed);
      }
      else {
        vars.outputSwapCount = uint8(nextRn(rngSeed) % 3);
        if (vars.outputToken != IoToken.Usdc) {
          vars.outputSwapType = SWAP_TYPE_GENERIC_SOLANA;
          uint32 deadline = uint32(nextRn(rngSeed));
          uint128 minOutputAmount = uint128(nextRn(rngSeed));
          vars.outputParams = abi.encodePacked(
            deadline,
            minOutputAmount,
            vars.outputSwapType
          );
          if (vars.outputToken == IoToken.Other) {
            vars.outputParams = abi.encodePacked(
              address(mockToken).toUniversalAddress(),
              vars.outputParams
            );
          }
        }
        else
          vars.outputParams = new bytes(0);
      }
    }

    if (xPercentOfTheTime(25, rngSeed)) {
      vars.transferMode = TransferMode.LiquidityLayerFast;
      vars.fastTransferMaxFee = FAST_FEE_MINIMUM;
      bool insufficientMaxTransferFee = xPercentOfTheTime(4, rngSeed);
      if (insufficientMaxTransferFee)
        vars.fastTransferMaxFee -= 1;
      else
        vars.fastTransferMaxFee += nextRn(rngSeed) % FAST_FEE_MINIMUM;
      vars.auctionDeadline = uint32(nextRn(rngSeed));
      vars.transferParams = abi.encodePacked(
        uint48(vars.fastTransferMaxFee),
        vars.auctionDeadline
      );
      vars.msgValue += 2*_wormholeMsgFee();
    }
    else {
      vars.transferMode = TransferMode.LiquidityLayer;
      vars.transferParams = new bytes(0);
      vars.msgValue += _wormholeMsgFee();
    }

    if (xPercentOfTheTime(33, rngSeed)) {
      vars.redeemMode = RedeemMode.Direct;
      vars.redeemParams = new bytes(0);
    }
    else if (xPercentOfTheTime(50, rngSeed)) {
      uint maxDropoff = 10 ether;
      vars.redeemMode = RedeemMode.Relay;
      if (xPercentOfTheTime(50, rngSeed)) {
        vars.gasDropoff = GasDropoff.wrap(uint32(nextRn(rngSeed)/3)).from() % maxDropoff +
          GasDropoff.wrap(1).from();
        vars.exceedMaxDropoff = xPercentOfTheTime(5, rngSeed);
        vm.prank(assistant);
        swapLayer.batchFeeUpdates(abi.encodePacked(
          vars.targetChain,
          FeeUpdate.MaxGasDropoff,
          GasDropoffLib.to(vars.exceedMaxDropoff ? vars.gasDropoff >> 1 : maxDropoff)
        ));
      }

      if (!vars.invalidSwap)
        vars.expectedRelayingFee = _swapLayerRelayingFee(
          vars.targetChain,
          vars.exceedMaxDropoff ? 0 : vars.gasDropoff,
          vars.outputToken,
          vars.outputSwapCount,
          vars.outputSwapType
        );

      vars.maxRelayingFee = vars.expectedRelayingFee;
      if (xPercentOfTheTime(5, rngSeed))
        vars.maxRelayingFee >>= 2;

      vars.redeemParams = abi.encodePacked(
        GasDropoff.unwrap(GasDropoffLib.to(vars.gasDropoff)),
        uint48(vars.maxRelayingFee)
      );
    }
    else {
      vars.redeemMode = RedeemMode.Payload;
      uint payloadLen = nextRn(rngSeed) % 10000;
      uint[] memory pl = new uint[](payloadLen/32 + 1);
      for (uint i = 0; i < pl.length; ++i)
        pl[i] = nextRn(rngSeed);

      (vars.redeemPayload,) = abi.encodePacked(pl).sliceUnchecked(0, payloadLen);
      vars.redeemParams = abi.encodePacked(uint16(vars.redeemPayload.length), vars.redeemPayload);
    }

    vars.isExactIn = xPercentOfTheTime(50, rngSeed);

    //set input amount so that it won't exceed available liquidity
    uint precision = 100; //use up to two decimals
    vars.inputAmount = nextRn(rngSeed) % (BASE_AMOUNT * precision) + 1;
    vars.inputToken = _fuzzIoToken(rngSeed);
    if (vars.inputToken == IoToken.Usdc)
      vars.inputAmount *= USDC;
    else if (vars.inputToken == IoToken.Gas) {
      vars.inputAmount *= 1 ether;
      vars.inputAmount /= USDC_PER_ETH;
    }
    else {
      vars.inputAmount *= 10**MOCK_TOKEN_DECIMALS;
      vars.inputAmount /= USDC_PER_MOCK_TOKEN;
    }
    //use only 20 % of available liquidity (maybe a bit more after including fees)
    vars.inputAmount /= 5;
    vars.inputAmount /= precision;

    if (vars.inputToken == IoToken.Usdc) {
      vars.inputParams = abi.encodePacked(uint128(vars.inputAmount), AcquireMode.Preapproved);
      vars.expectedSentAmount = vars.inputAmount;
    }
    else {
      vars.deadline = _fuzzDeadline(3, rngSeed);
      vars.slippageExceeded = xPercentOfTheTime(3, rngSeed);
      if (!vars.isExactIn)
        //add fees + 100 % buffer to input amount
        vars.inputAmount += _convertAmount(
          IoToken.Usdc,
          2 * (vars.expectedRelayingFee + vars.fastTransferMaxFee),
          vars.inputToken
        );

      vars.outputAmount = uint128(_convertAmount(vars.inputToken, vars.inputAmount, IoToken.Usdc));
      if (vars.slippageExceeded)
        vars.outputAmount *= 2;
      else
        vars.outputAmount /= 10;
      uint8 swapType = _fuzzEvmSwapType(rngSeed);
      if (vars.inputToken == IoToken.Gas)
        vars.msgValue += vars.inputAmount;

      (, , vars.expectedSentAmount) = _simulateSwap(
        vars.isExactIn,
        vars.inputToken,
        vars.inputAmount,
        vars.outputAmount,
        swapType
      );

      vars.inputParams = _composeInputParams(
        vars.inputToken,
        vars.inputAmount,
        vars.outputAmount,
        vars.deadline,
        swapType
      );
    }
    if (!vars.isExactIn)
      vars.expectedSentAmount += vars.expectedRelayingFee + vars.fastTransferMaxFee;

    _fundUser(vars.inputToken);

    vars.userBalanceBeforeEth = user.balance;
    vars.userBalanceBeforeMock = mockToken.balanceOf(user);
    vars.userBalanceBeforeUsdc = usdc.balanceOf(user);
    vars.feeRecipientBalanceBeforeUsdc = usdc.balanceOf(feeRecipient);
    vars.sequenceBefore = wormhole.nextSequence(address(liquidityLayer));

    if (xPercentOfTheTime(1, rngSeed))
      vars.targetChain = type(uint16).max;

    console.log("msgValue: %d", vars.msgValue);
    console.log("targetChain: %d", vars.targetChain);

    console.log("transferMode: %d", uint8(vars.transferMode));
    console.log("fastTransferMaxFee: %d", vars.fastTransferMaxFee);
    console.log("transferParams");
    console.logBytes(vars.transferParams);

    console.log("redeemMode: %d", uint8(vars.redeemMode));
    console.log("gasDropoff: %d", vars.gasDropoff);
    console.log("exceedMaxDropoff: %d", vars.exceedMaxDropoff);
    console.log("maxRelayingFee: %d", vars.maxRelayingFee);
    console.log("expectedRelayingFee: %d", vars.expectedRelayingFee);
    console.log("redeemPayloadLength: %d", vars.redeemPayload.length);
    console.log("redeemParams");
    console.logBytes(vars.redeemParams);

    console.log("isExactIn: %d", vars.isExactIn);

    console.log("inputToken: %d", uint8(vars.inputToken));
    console.log("inputAmount: %d", vars.inputAmount);
    console.log("deadline: %d", vars.deadline);
    console.log("timestamp: %d", block.timestamp);
    console.log("outputAmount: %d", vars.outputAmount);
    console.log("slippageExceeded: %d", vars.slippageExceeded);
    console.log("expectedSentAmount: %d", vars.expectedSentAmount);
    console.log("inputParams");
    console.logBytes(vars.inputParams);

    console.log("outputToken: %d", uint8(vars.outputToken));
    console.log("outputSwapCount: %d", vars.outputSwapCount);
    console.log("outputSwapType: %d", vars.outputSwapType);
    console.log("outputParams");
    console.logBytes(vars.outputParams);

    vm.recordLogs();
    vm.prank(user);
    (bool success, bytes memory returnData) = address(swapLayer).call{value: vars.msgValue}(
      abi.encodeCall(
        swapLayer.initiate, (
          vars.targetChain,
          user.toUniversalAddress(),
          abi.encodePacked(
            vars.transferMode,
            vars.transferParams,
            vars.redeemMode,
            vars.redeemParams,
            vars.isExactIn,
            vars.inputToken,
            vars.inputParams,
            vars.outputToken,
            vars.outputParams
          )
        )
      )
    );

    (bytes4 maybeErrorSelector, ) = returnData.asBytes4Unchecked(0);

    if (vars.exceedMaxDropoff || (vars.targetChain == type(uint16).max && vars.gasDropoff > 0)) {
      assertFalse(success, "maxDropoff exceeded");
      assertEq(returnData.length, 4+32+32);
      assertEq(maybeErrorSelector, ExceedsMaxGasDropoff.selector);
      return;
    }

    if (vars.expectedRelayingFee > vars.maxRelayingFee) {
      assertFalse(success, "maxRelayingFee exceeded");
      assertEq(returnData.length, 4+32+32);
      assertEq(maybeErrorSelector, ExceedsMaxRelayingFee.selector);
      return;
    }

    if (vars.redeemMode == RedeemMode.Relay && vars.outputSwapType > 0 && (
        (vars.targetChain == SOLANA_CHAIN_ID &&
          vars.outputSwapType != SWAP_TYPE_GENERIC_SOLANA) ||
        (vars.targetChain != SOLANA_CHAIN_ID &&
          vars.outputSwapType == SWAP_TYPE_GENERIC_SOLANA)
    )) {
      assertFalse(success, "outputSwapType and chain mismatch");
      assertEq(maybeErrorSelector, InvalidSwapTypeForChain.selector);
      return;
    }

    if (vars.deadline != 0 && vars.deadline < block.timestamp) {
      assertFalse(success, "deadline expired");
      assertEq(maybeErrorSelector, DeadlineExpired.selector);
      return;
    }

    if (vars.slippageExceeded) {
      assertFalse(success, "slippage exceeded");
      assertEq(maybeErrorSelector, SwapFailed.selector);
      return;
    }

    if (vars.targetChain == type(uint16).max) {
      assertFalse(success, "invalid targetChain");
      assertEq(returnData, abi.encodePacked(ChainNotSupported.selector, uint(type(uint16).max)));
      return;
    }

    if (vars.transferMode == TransferMode.LiquidityLayerFast) {
      if (vars.expectedSentAmount < liquidityLayer.getMinFastTransferAmount()) {
        assertFalse(success, "sent amount too low for fast transfers");
        assertEq(maybeErrorSelector, bytes4(keccak256("ErrInsufficientAmount(uint64,uint64)")));
        return;
      }

      if (vars.expectedSentAmount > FAST_TRANSFER_MAX_AMOUNT) {
        assertFalse(success, "fastTransferMaxAmount exceeded");
        assertEq(maybeErrorSelector, bytes4(keccak256("ErrAmountTooLarge(uint64,uint64)")));
        return;
      }

      if (vars.fastTransferMaxFee <= FAST_FEE_MINIMUM) {
        assertFalse(success, "max fast fee too low");
        assertEq(maybeErrorSelector, bytes4(keccak256("ErrInvalidMaxFee(uint64,uint64)")));
        return;
      }
    }

    assertTrue(success);
    returnData = abi.decode(returnData, (bytes));

    {
      uint offset = 0;
      (vars.sentAmount, offset) = returnData.asUint256Unchecked(offset);
      assertEq(vars.sentAmount, vars.expectedSentAmount, "sentAmount mismatch");

      uint64 sequence;
      (sequence, offset) = returnData.asUint64Unchecked(offset + 24);
      assertEq(sequence, vars.sequenceBefore, "sequence mismatch");

      offset += 32; //skip protocolSequence

      if (vars.transferMode == TransferMode.LiquidityLayerFast) {
        uint64 fastSequence;
        (fastSequence, offset) = returnData.asUint64Unchecked(offset + 24);
        assertEq(fastSequence, vars.sequenceBefore + 1, "fastSequence mismatch");
      }

      if (vars.redeemMode == RedeemMode.Relay) {
        uint relayingFee;
        (relayingFee, offset) = returnData.asUint256Unchecked(offset);
        assertLt(relayingFee, vars.maxRelayingFee + 1, "maxRelayingFee"); //no less than or equal
        assertEq(relayingFee, vars.expectedRelayingFee, "relayingFee mismatch");
      }
    }

    assertEq(
      usdc.balanceOf(user),
      vars.userBalanceBeforeUsdc - (vars.inputToken == IoToken.Usdc ? vars.expectedSentAmount : 0),
      "usdc balance"
    );
    if (vars.inputToken == IoToken.Gas && !vars.isExactIn)
      assertGt(user.balance + 1, vars.userBalanceBeforeEth - vars.msgValue, "eth balance");
    else
      assertEq(user.balance, vars.userBalanceBeforeEth - vars.msgValue, "eth balance");

    if (vars.inputToken == IoToken.Other) {
      if (vars.isExactIn)
        assertEq(
          mockToken.balanceOf(user),
          vars.userBalanceBeforeMock - vars.inputAmount,
          "mock balance"
        );
      else
        assertGt(
          mockToken.balanceOf(user) + 1,
          vars.userBalanceBeforeMock - vars.inputAmount,
          "mock balance"
        );
    }
    else
      assertEq(mockToken.balanceOf(user), vars.userBalanceBeforeMock, "mock balance");

    assertEq(address(swapLayer).balance, 0, "swap layer eth balance");
    assertEq(mockToken.balanceOf(address(swapLayer)), 0, "swap layer mock token balance");
    assertEq(usdc.balanceOf(address(swapLayer)), 0, "swap layer usdc balance");

    PublishedMessage[] memory pubMsgs = wormhole.fetchPublishedMessages(vm.getRecordedLogs());
    assertEq(
      pubMsgs.length,
      vars.transferMode == TransferMode.LiquidityLayerFast ? 2 : 1,
      "emitted wormhole messages"
    );

    bytes memory depositPayload;
    {
      (
        bytes32 token,
        uint256 cctpAmount,
        , //uint32 sourceCctpDomain,
        , //uint32 targetCctpDomain,
        , //uint64 cctpNonce,
        , //bytes32 burnSource,
        bytes32 mintRecipient,
        bytes memory payload
      ) = WormholeCctpMessages.decodeDeposit(pubMsgs[0].payload);

      assertEq(token, address(usdc).toUniversalAddress(), "deposit token");
      assertEq(cctpAmount, vars.expectedSentAmount, "deposit cctpAmount");
      assertEq(
        mintRecipient,
        vars.transferMode == TransferMode.LiquidityLayerFast
        ? MATCHING_ENGINE_MINT_RECIPIENT
        : FOREIGN_LIQUIDITY_LAYER,
        "deposit mintRecipient"
      );

      depositPayload = payload;
    }

    bytes memory swapMessage;
    bytes32 expectedRedeemer = vars.targetChain == SOLANA_CHAIN_ID
      ? SOLANA_SWAP_LAYER
      : FOREIGN_SWAP_LAYER;
    if (vars.transferMode == TransferMode.LiquidityLayerFast) {
      LiquidityLayerMessages.SlowOrderResponse memory slowResp =
        LiquidityLayerMessages.decodeSlowOrderResponse(depositPayload);

      assertEq(slowResp.baseFee, FAST_TRANSFER_BASE_FEE, "slow order baseFee");

      LiquidityLayerMessages.FastMarketOrder memory fastOrder =
        LiquidityLayerMessages.decodeFastMarketOrder(pubMsgs[1].payload);

      uint expectedMaxFee = vars.fastTransferMaxFee - FAST_TRANSFER_INIT_AUCTION_FEE;
      assertEq(fastOrder.amountIn, vars.expectedSentAmount, "fast order amountIn");
      assertEq(fastOrder.targetChain, vars.targetChain, "fast order targetChain");
      assertEq(fastOrder.redeemer, expectedRedeemer, "fast order redeemer");
      assertEq(fastOrder.sender, address(swapLayer).toUniversalAddress(), "fast order sender");
      assertEq(fastOrder.maxFee, expectedMaxFee, "fast order maxFee");
      assertEq(fastOrder.deadline, vars.auctionDeadline, "fast order deadline");

      swapMessage = fastOrder.redeemerMessage;
    }
    else {
      LiquidityLayerMessages.Fill memory fill = LiquidityLayerMessages.decodeFill(depositPayload);
      assertEq(fill.orderSender, address(swapLayer).toUniversalAddress(), "fill sender");
      assertEq(fill.redeemer, expectedRedeemer, "fill redeemer");

      swapMessage = fill.redeemerMessage;
    }

    SwapMessageStructure memory sms = parseSwapMessageStructure(swapMessage);
    assertEq(sms.recipient, user, "recipient");

    assertEq(uint8(sms.redeemMode), uint8(vars.redeemMode));
    if (vars.redeemMode == RedeemMode.Relay) {
      (bytes memory relaySlice, ) = swapMessage.slice(sms.redeemOffset, 4+6);
      bytes memory expectedRelayParams = abi.encodePacked(
        GasDropoff.unwrap(GasDropoffLib.to(vars.gasDropoff)),
        uint48(vars.expectedRelayingFee)
      );
      assertEq(relaySlice, expectedRelayParams, "relaying slice");

      //separately also (somewhat redundantly) test parsing function
      (GasDropoff gasDropoffMsg, uint relayingFeeMsg, ) =
        parseRelayParams(swapMessage, sms.redeemOffset);
      assertEq(gasDropoffMsg.from(), vars.gasDropoff, "msg gas dropoff");
      assertEq(relayingFeeMsg, vars.expectedRelayingFee, "msg relaying fee");
      assertEq(sms.payload.length, 0);
    }
    else if (vars.redeemMode == RedeemMode.Payload) {
      (uint payloadLenMsg, uint offset) = swapMessage.asUint16Unchecked(sms.redeemOffset);
      assertEq(payloadLenMsg, vars.redeemPayload.length, "redeem payload length");
      (bytes memory payload, ) = swapMessage.slice(offset, vars.redeemPayload.length);
      assertEq(payload, vars.redeemPayload, "redeem payload");
    }
    else
      assertEq(sms.payload.length, 0);

    {
      (IoToken outputToken, uint offset) = parseIoToken(swapMessage, sms.swapOffset);
      assertEq(uint8(outputToken), uint8(vars.outputToken), "output token");
      bytes memory outputSwap;
      (outputSwap, offset) = swapMessage.sliceUnchecked(offset, swapMessage.length - offset);
      assertEq(outputSwap, vars.outputParams, "output swap");
    }
  }

  function testPausedRelay() public {
    vm.prank(assistant);
    swapLayer.batchFeeUpdates(abi.encodePacked(
      FOREIGN_CHAIN_ID,
      FeeUpdate.BaseFee,
      uint32(type(uint32).max)
    ));

    uint amount = USER_AMOUNT * USDC;
    _dealOverride(address(usdc), user, amount);
    vm.startPrank(user);
    usdc.approve(address(swapLayer), amount);

    (bool success, bytes memory errorData) = _swapLayerInitiateRaw(_swapLayerComposeInitiate(
      InitiateRelayUsdc({
        targetParams: TargetParams(FOREIGN_CHAIN_ID, recipient.toUniversalAddress()),
        relayParams: RelayParams({gasDropoffWei: 0, maxRelayingFeeUsdc: amount/10 }),
        amount: amount,
        isExactIn: true,
        outputParams: _swapLayerEncodeOutputParamsUsdc()
      })
    ));

    assertEq(success, false);
    assertEq(errorData.length, 4);
    (bytes4 errorSelector, ) = errorData.asBytes4Unchecked(0);
    assertEq(errorSelector, RelayingDisabledForChain.selector);
  }

  //approveCheck test
}
