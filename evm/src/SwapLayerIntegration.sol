// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "wormhole-sdk/libraries/BytesParsing.sol";

import "wormhole-sdk/interfaces/IWormhole.sol";
import "./ISwapLayer.sol";
import "./assets/FeeParams.sol";
import "./assets/Message.sol";
import {QueryType, ImmutableType} from "./assets/SwapLayerQuery.sol";
import {TransferMode, RedeemMode, IoToken, AcquireMode} from "./assets/InitiateParams.sol";
import {AttestationType} from "./assets/SwapLayerRedeem.sol";

abstract contract SwapLayerIntegration {
  using BytesParsing for bytes;

  error InvalidPathParams();
  error ExceedsMaximum(uint256 value, uint256 maximum);

  ISwapLayer internal immutable _swapLayer;
  address    internal immutable _wormhole;
  address    internal immutable _usdc;
  address    internal immutable _wrappedNative;

  constructor(address swapLayer) {
    _swapLayer     = ISwapLayer(payable(swapLayer));
    _wormhole      = _getImmutable(ImmutableType.Wormhole);
    _usdc          = _getImmutable(ImmutableType.Usdc);
    _wrappedNative = _getImmutable(ImmutableType.WrappedNative);
  }

  // -----------------------------------------------------------------------------------------------
  // ---------------------------------------- Initiate Slow ----------------------------------------
  // -----------------------------------------------------------------------------------------------

  // ------------------------ Initiate Slow Direct ------------------------

  function _swapLayerInitiateNative(
    uint16 targetChain,
    bytes32 recipient,
    bool isExactIn,
    uint256 amount, //wormhole message fee is taken from this amount too
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    bytes memory params = abi.encodePacked(
      uint8(TransferMode.LiquidityLayer),
      uint8(RedeemMode.Direct),
      _encodeBool(isExactIn),
      uint8(IoToken.Gas),
      inputSwap,
      outputParams
    );

    return _initiateSlow(amount, targetChain, recipient, params);
  }

  function _swapLayerInitiateUsdc(
    uint16 targetChain,
    bytes32 recipient,
    uint256 amount,
    bytes memory outputParams
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    bytes memory params = abi.encodePacked(
      uint8(TransferMode.LiquidityLayer),
      uint8(RedeemMode.Direct),
      _encodeBool(false), //isExactIn - irrelevant
      _encodeUsdcIn(amount),
      outputParams
    );

    return _initiateSlow(_wormholeMsgFee(), targetChain, recipient, params);
  }

  function _swapLayerInitiateToken(
    uint16 targetChain,
    bytes32 recipient,
    address inputToken,
    bool isExactIn,
    uint256 amount,
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    bytes memory params = abi.encodePacked(
      uint8(TransferMode.LiquidityLayer),
      uint8(RedeemMode.Direct),
      _encodeBool(isExactIn),
      _encodeTokenIn(),
      inputToken,
      _encodeAmount(amount),
      inputSwap,
      outputParams
    );

    return _initiateSlow(_wormholeMsgFee(), targetChain, recipient, params);
  }

  // ------------------------ Initiate Slow Relay ------------------------

  function _swapLayerInitiateRelayNative(
    uint16 targetChain,
    bytes32 recipient,
    uint256 gasDropoffWei,
    uint256 maxRelayerFeeUsdc,
    bool isExactIn,
    uint256 amount,
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint256 relayingFeeUsdc
  ) {
    bytes memory params = abi.encodePacked(
      uint8(TransferMode.LiquidityLayer),
      _encodeRelayParams(gasDropoffWei, maxRelayerFeeUsdc),
      _encodeBool(isExactIn),
      uint8(IoToken.Gas),
      inputSwap,
      outputParams
    );

    return _initiateRelaySlow(amount, targetChain, recipient, params);
  }

  function _swapLayerInitiateRelayUsdc(
    uint16 targetChain,
    bytes32 recipient,
    uint256 gasDropoffWei,
    uint256 maxRelayerFeeUsdc,
    bool isExactIn,
    uint256 amount,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint256 relayingFeeUsdc
  ) {
    bytes memory params = abi.encodePacked(
      uint8(TransferMode.LiquidityLayer),
      _encodeRelayParams(gasDropoffWei, maxRelayerFeeUsdc),
      _encodeBool(isExactIn),
      _encodeUsdcIn(amount),
      outputParams
    );

    return _initiateRelaySlow(_wormholeMsgFee(), targetChain, recipient, params);
  }

  function _swapLayerInitiateRelayToken(
    uint16 targetChain,
    bytes32 recipient,
    uint256 gasDropoffWei,
    uint256 maxRelayerFeeUsdc,
    address inputToken,
    bool isExactIn,
    uint256 amount,
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint256 relayingFeeUsdc
  ) {
    bytes memory params = abi.encodePacked(
      uint8(TransferMode.LiquidityLayer),
      _encodeRelayParams(gasDropoffWei, maxRelayerFeeUsdc),
      _encodeBool(isExactIn),
      _encodeTokenIn(),
      inputToken,
      _encodeAmount(amount),
      inputSwap,
      outputParams
    );

    return _initiateRelaySlow(_wormholeMsgFee(), targetChain, recipient, params);
  }

  // ------------------------ Initiate Slow Payload ------------------------

  function _swapLayerInitiatePayloadNative(
    uint16 targetChain,
    bytes32 recipient,
    bytes memory payload,
    bool isExactIn,
    uint256 amount,
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    bytes memory params = abi.encodePacked(
      uint8(TransferMode.LiquidityLayer),
      _encodePayloadParams(payload),
      _encodeBool(isExactIn),
      uint8(IoToken.Gas),
      inputSwap,
      outputParams
    );

    return _initiateSlow(amount, targetChain, recipient, params);
  }

  function _swapLayerInitiatePayloadUsdc(
    uint16 targetChain,
    bytes32 recipient,
    bytes memory payload,
    uint256 amount,
    bytes memory outputParams
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    bytes memory params = abi.encodePacked(
      uint8(TransferMode.LiquidityLayer),
      _encodePayloadParams(payload),
      _encodeBool(false), //isExactIn - irrelevant
      _encodeUsdcIn(amount),
      outputParams
    );

    return _initiateSlow(_wormholeMsgFee(), targetChain, recipient, params);
  }

  function _swapLayerInitiatePayloadToken(
    uint16 targetChain,
    bytes32 recipient,
    bytes memory payload,
    address inputToken,
    bool isExactIn,
    uint256 amount,
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    bytes memory params = abi.encodePacked(
      uint8(TransferMode.LiquidityLayer),
      _encodePayloadParams(payload),
      _encodeBool(isExactIn),
      _encodeTokenIn(),
      inputToken,
      _encodeAmount(amount),
      inputSwap,
      outputParams
    );

    return _initiateSlow(_wormholeMsgFee(), targetChain, recipient, params);
  }

  // -----------------------------------------------------------------------------------------------
  // ---------------------------------------- Initiate Fast ----------------------------------------
  // -----------------------------------------------------------------------------------------------

  // ------------------------ Initiate Fast Direct ------------------------

  function _swapLayerInitiateNativeFast(
    uint16 targetChain,
    bytes32 recipient,
    uint256 maxFastFeeUsdc,
    uint256 auctionDeadline,
    bool isExactIn,
    uint256 amount, //wormhole message fee is taken from this amount too
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    bytes memory params = abi.encodePacked(
      _encodeFastTransferParams(maxFastFeeUsdc, auctionDeadline),
      uint8(RedeemMode.Direct),
      _encodeBool(isExactIn),
      uint8(IoToken.Gas),
      inputSwap,
      outputParams
    );

    return _initiateFast(amount, targetChain, recipient, params);
  }

  function _swapLayerInitiateUsdcFast(
    uint16 targetChain,
    bytes32 recipient,
    uint256 maxFastFeeUsdc,
    uint256 auctionDeadline,
    bool isExactIn,
    uint256 amount,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    bytes memory params = abi.encodePacked(
      _encodeFastTransferParams(maxFastFeeUsdc, auctionDeadline),
      uint8(RedeemMode.Direct),
      _encodeBool(isExactIn),
      _encodeUsdcIn(amount),
      outputParams
    );

    return _initiateFast(2*_wormholeMsgFee(), targetChain, recipient, params);
  }

  function _swapLayerInitiateTokenFast(
    uint16 targetChain,
    bytes32 recipient,
    uint256 maxFastFeeUsdc,
    uint256 auctionDeadline,
    address inputToken,
    bool isExactIn,
    uint256 amount,
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    bytes memory params = abi.encodePacked(
      _encodeFastTransferParams(maxFastFeeUsdc, auctionDeadline),
      uint8(RedeemMode.Direct),
      _encodeBool(isExactIn),
      _encodeTokenIn(),
      inputToken,
      _encodeAmount(amount),
      inputSwap,
      outputParams
    );

    return _initiateFast(2*_wormholeMsgFee(), targetChain, recipient, params);
  }

  // ------------------------ Initiate Fast Relay ------------------------

  function _swapLayerInitiateRelayNativeFast(
    uint16 targetChain,
    bytes32 recipient,
    uint256 maxFastFeeUsdc,
    uint256 auctionDeadline,
    uint256 gasDropoffWei,
    uint256 maxRelayerFeeUsdc,
    bool isExactIn,
    uint256 amount,
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence,
    uint64 relayingFeeUsdc
  ) {
    bytes memory params = abi.encodePacked(
      _encodeFastTransferParams(maxFastFeeUsdc, auctionDeadline),
      _encodeRelayParams(gasDropoffWei, maxRelayerFeeUsdc),
      _encodeBool(isExactIn),
      uint8(IoToken.Gas),
      inputSwap,
      outputParams
    );

    return _initiateRelayFast(amount, targetChain, recipient, params);
  }

  function _swapLayerInitiateRelayUsdcFast(
    uint16 targetChain,
    bytes32 recipient,
    uint256 maxFastFeeUsdc,
    uint256 auctionDeadline,
    uint256 gasDropoffWei,
    uint256 maxRelayerFeeUsdc,
    bool isExactIn,
    uint256 amount,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence,
    uint64 relayingFeeUsdc
  ) {
    bytes memory params = abi.encodePacked(
      _encodeFastTransferParams(maxFastFeeUsdc, auctionDeadline),
      _encodeRelayParams(gasDropoffWei, maxRelayerFeeUsdc),
      _encodeBool(isExactIn),
      _encodeUsdcIn(amount),
      outputParams
    );

    return _initiateRelayFast(2*_wormholeMsgFee(), targetChain, recipient, params);
  }

  function _swapLayerInitiateRelayTokenFast(
    uint16 targetChain,
    bytes32 recipient,
    uint256 maxFastFeeUsdc,
    uint256 auctionDeadline,
    uint256 gasDropoffWei,
    uint256 maxRelayerFeeUsdc,
    address inputToken,
    bool isExactIn,
    uint256 amount,
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence,
    uint64 relayingFeeUsdc
  ) {
    bytes memory params = abi.encodePacked(
      _encodeFastTransferParams(maxFastFeeUsdc, auctionDeadline),
      _encodeRelayParams(gasDropoffWei, maxRelayerFeeUsdc),
      _encodeBool(isExactIn),
      _encodeTokenIn(),
      inputToken,
      _encodeAmount(amount),
      inputSwap,
      outputParams
    );

    return _initiateRelayFast(2*_wormholeMsgFee(), targetChain, recipient, params);
  }

  // ------------------------ Initiate Fast Payload ------------------------

  function _swapLayerInitiatePayloadNativeFast(
    uint16 targetChain,
    bytes32 recipient,
    uint256 maxFastFeeUsdc,
    uint256 auctionDeadline,
    bytes memory payload,
    bool isExactIn,
    uint256 amount,
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    bytes memory params = abi.encodePacked(
      _encodeFastTransferParams(maxFastFeeUsdc, auctionDeadline),
      _encodePayloadParams(payload),
      _encodeBool(isExactIn),
      uint8(IoToken.Gas),
      inputSwap,
      outputParams
    );

    return _initiateFast(amount, targetChain, recipient, params);
  }

  function _swapLayerInitiatePayloadUsdcFast(
    uint16 targetChain,
    bytes32 recipient,
    uint256 maxFastFeeUsdc,
    uint256 auctionDeadline,
    bytes memory payload,
    bool isExactIn,
    uint256 amount,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    bytes memory params = abi.encodePacked(
      _encodeFastTransferParams(maxFastFeeUsdc, auctionDeadline),
      _encodePayloadParams(payload),
      _encodeBool(isExactIn),
      _encodeUsdcIn(amount),
      outputParams
    );

    return _initiateFast(2*_wormholeMsgFee(), targetChain, recipient, params);
  }

  function _swapLayerInitiatePayloadTokenFast(
    uint16 targetChain,
    bytes32 recipient,
    uint256 maxFastFeeUsdc,
    uint256 auctionDeadline,
    bytes memory payload,
    address inputToken,
    bool isExactIn,
    uint256 amount,
    bytes memory inputSwap,
    bytes memory outputParams
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    bytes memory params = abi.encodePacked(
      _encodeFastTransferParams(maxFastFeeUsdc, auctionDeadline),
      _encodePayloadParams(payload),
      _encodeBool(isExactIn),
      _encodeTokenIn(),
      inputToken,
      _encodeAmount(amount),
      inputSwap,
      outputParams
    );

    return _initiateFast(2*_wormholeMsgFee(), targetChain, recipient, params);
  }


  // -----------------------------------------------------------------------------------------------
  // ------------------------------------------- Redeem --------------------------------------------
  // -----------------------------------------------------------------------------------------------

  function _swapLayerRedeem(
    bytes calldata attestation
  ) internal returns (address outputToken, uint256 outputAmount) {
    return abi.decode(
      _swapLayer.redeem(uint8(AttestationType.LiquidityLayer), attestation, new bytes(0)),
      (address, uint256)
    );
  }

  function _swapLayerRedeemWithPayload(
    bytes calldata attestation
  ) internal returns (address outputToken, uint256 outputAmount, bytes memory payload) {
    return abi.decode(
      _swapLayer.redeem(uint8(AttestationType.LiquidityLayer), attestation, new bytes(0)),
      (address, uint256, bytes)
    );
  }

  function _swapLayerRedeemOverride(
    bytes calldata attestation,
    bytes memory outputSwap
  ) internal returns (address outputToken, uint256 outputAmount) {
    return abi.decode(
      _swapLayer.redeem(uint8(AttestationType.LiquidityLayer), attestation, outputSwap),
      (address, uint256)
    );
  }

  function _swapLayerRedeemOverrideWithPayload(
    bytes calldata attestation,
    bytes memory outputSwap
  ) internal returns (address outputToken, uint256 outputAmount, bytes memory payload) {
    return abi.decode(
      _swapLayer.redeem(uint8(AttestationType.LiquidityLayer), attestation, outputSwap),
      (address, uint256, bytes)
    );
  }

  // function _swapLayerRedeemOverrideGasUniswap(
  //   uint128 minOutAmount,
  //   uint32 deadline,
  //   uint24[] memory pathFees,
  //   address[] memory intermediateTokens,
  //   OrderResponse calldata attestations
  // ) internal returns (bytes memory) {
  //   return _swapLayer.redeem(
  //     abi.encodePacked(uint8(IoToken.Gas)),
  //     attestations
  //   );
  // }

  // function _swapLayerRedeemOverrideUniswap(
  //   uint128 minOutAmount,
  //   uint32 deadline,
  //   uint24[] memory pathFees,
  //   address[] memory intermediateTokens, //must have length of pathFees.length - 1
  //   OrderResponse calldata attestations
  // ) internal returns (bytes memory) {
  //   if (pathFees.length != intermediateTokens.length + 1)
  //     revert InvalidPathParams();

  //   return _swapLayer.redeem(amount, new bytes(0), attestations);
  // }

  // function _swapLayerRedeemOverrideTradeJoe(
  //   uint128 minOutAmount,
  //   uint32 deadline,
  //   uint24[] memory poolIds, //packed: uint8 version, uint16 pairBinStep
  //   address[] memory intermediateTokens, //must have length of poolIds.length or poolIds.length - 1
  //   OrderResponse calldata attestations
  // ) internal returns (bytes memory) {
  //   if (poolIds.length != intermediateTokens.length + 1)
  //     revert InvalidPathParams();
  
  //   return _swapLayer.redeem(amount, new bytes(0), swapMessage);
  // }

  // ---- Mutable Getters ----

  function _swapLayerGetFeeParams(uint16 chainId) internal view returns (FeeParams) {
    (uint256 params, ) = _swapLayer.batchQueries(abi.encodePacked(
      uint8(QueryType.FeeParams),
      chainId
    )).asUint256Unchecked(0);
    return FeeParams.wrap(params);
  }

  function _swapLayerGetPeer(uint16 chainId) internal view returns (bytes32 universalAddr) {
    (universalAddr, ) = _swapLayer.batchQueries(abi.encodePacked(
      uint8(QueryType.Peer),
      chainId
    )).asBytes32Unchecked(0);
  }

  function _swapLayerOwner() internal view returns (address) {
    return _getAddr(abi.encodePacked(uint8(QueryType.Owner)));
  }

  function _swapLayerPendingOwner() internal view returns (address) {
    return _getAddr(abi.encodePacked(uint8(QueryType.PendingOwner)));
  }

  function _swapLayerAssistant() internal view returns (address) {
    return _getAddr(abi.encodePacked(uint8(QueryType.Assistant)));
  }

  function _swapLayerFeeUpdater() internal view returns (address) {
    return _getAddr(abi.encodePacked(uint8(QueryType.FeeUpdater)));
  }

  function _swapLayerFeeRecipient() internal view returns (address) {
    return _getAddr(abi.encodePacked(uint8(QueryType.FeeRecipient)));
  }

  function _swapLayerImplementation() internal view returns (address) {
    return _getAddr(abi.encodePacked(uint8(QueryType.Implementation)));
  }

  // ---- Immutable Getters ----

  function _swapLayerWormhole() internal view returns (address) {
    return _wormhole;
  }

  function _swapLayerUsdc() internal view returns (address) {
    return _usdc;
  }

  function _swapLayerWrappedNative() internal view returns (address) {
    return _wrappedNative;
  }

  function _swapLayerPermit2() internal view returns (address) {
    return _getImmutable(ImmutableType.Permit2);
  }

  function _swapLayerUniswapRouter() internal view returns (address) {
    return _getImmutable(ImmutableType.UniswapRouter);
  }

  function _swapLayerTraderJoeRouter() internal view returns (address) {
    return _getImmutable(ImmutableType.TraderJoeRouter);
  }

  function _swapLayerLiquidityLayer() internal view returns (address) {
    return _getImmutable(ImmutableType.LiquidityLayer);
  }

  // ---- Utils ----

  function _wormholeMsgFee() internal view returns (uint256) {
    return IWormhole(_wormhole).messageFee();
  }

  function _checkMax(uint256 val, uint256 max) internal pure {
    if (val > max)
      revert ExceedsMaximum(val, max);
  }

  // ---- Private ----

  function _encodeFastTransferParams(
    uint maxFastFeeUsdc,
    uint auctionDeadline
  ) private pure returns (uint88) {
    _checkMax(maxFastFeeUsdc, type(uint48).max);
    _checkMax(auctionDeadline, type(uint32).max);

    return uint88(((
      uint(TransferMode.LiquidityLayerFast) << 48) +
      maxFastFeeUsdc << 32) +
      auctionDeadline
    );
  }

  function _encodeRelayParams(
    uint gasDropoffWei,
    uint maxRelayerFeeUsdc
  ) private pure returns (uint88) {
    _checkMax(maxRelayerFeeUsdc, type(uint48).max);

    return uint88((
      uint(RedeemMode.Relay) << 32) +
      uint(GasDropoff.unwrap(GasDropoffLib.to(gasDropoffWei)) << 48) +
      maxRelayerFeeUsdc
    );
  }

  function _encodePayloadParams(
    bytes memory payload
  ) private pure returns (bytes memory) {
    return abi.encodePacked(uint8(RedeemMode.Payload), uint32(payload.length), payload);
  }

  function _encodeUsdcIn(uint amount) private pure returns (uint144) {
    return uint144(((
      uint(IoToken.Usdc) << 128) +
      _encodeAmount(amount) << 8) +
      uint(AcquireMode.Preapproved)
    );
  }

  function _encodeTokenIn() private pure returns (uint24) {
    return uint24(((
      uint(IoToken.Other) << 8) +
      uint(AcquireMode.Preapproved) << 8) +
      _encodeBool(true) //approveCheck
    );
  }

  function _encodeAmount(uint amount) private pure returns (uint128) {
    _checkMax(amount, type(uint128).max);

    return uint128(amount);
  }

  function _encodeBool(bool isExactIn) private pure returns (uint8) {
    return uint8(isExactIn ? 1 : 0);
  }

  function _getImmutable(ImmutableType immutabl) private view returns (address) {
    return _getAddr(abi.encodePacked(uint8(QueryType.Immutable), uint8(immutabl)));
  }

  function _getAddr(bytes memory query) private view returns (address addr) {
    (addr, ) = _swapLayer.batchQueries(query).asAddressUnchecked(0);
  }

  function _initiateSlow(
    uint256 msgValue,
    uint16 targetChain,
    bytes32 recipient,
    bytes memory params
  ) private returns (uint64, uint64, uint256) {
    return abi.decode(
      _swapLayer.initiate{value: msgValue}(targetChain, recipient, params),
      (uint64, uint64, uint256)
    );
  }

  function _initiateRelaySlow(
    uint256 msgValue,
    uint16 targetChain,
    bytes32 recipient,
    bytes memory params
  ) private returns (uint64, uint64, uint256, uint64) {
    return abi.decode(
      _swapLayer.initiate{value: msgValue}(targetChain, recipient, params),
      (uint64, uint64, uint256, uint64)
    );
  }

  function _initiateFast(
    uint256 msgValue,
    uint16 targetChain,
    bytes32 recipient,
    bytes memory params
  ) private returns (uint64, uint64, uint256, uint64) {
    return abi.decode(
      _swapLayer.initiate{value: msgValue}(targetChain, recipient, params),
      (uint64, uint64, uint256, uint64)
    );
  }
  function _initiateRelayFast(
    uint256 msgValue,
    uint16 targetChain,
    bytes32 recipient,
    bytes memory params
  ) private returns (uint64, uint64, uint256, uint64, uint64) {
    return abi.decode(
      _swapLayer.initiate{value: msgValue}(targetChain, recipient, params),
      (uint64, uint64, uint256, uint64, uint64)
    );
  }
}
