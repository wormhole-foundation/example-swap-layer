// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { BytesParsing } from "wormhole-sdk/libraries/BytesParsing.sol";
import { IWormhole } from "wormhole-sdk/interfaces/IWormhole.sol";
import { toUniversalAddress } from "wormhole-sdk/Utils.sol";

import {
  BOOL_SIZE,
  ADDRESS_SIZE,
  MODE_SIZE,
  SWAP_PARAM_AMOUNT_SIZE,
  SWAP_PARAM_DEADLINE_SIZE,
  SHARED_POOL_ID_SIZE,
  SHARED_PATH_ELEMENT_SIZE,
  SWAP_TYPE_TRADERJOE,
  SWAP_TYPE_UNISWAPV3,
  SWAP_TYPE_GENERIC_SOLANA
} from "./assets/Params.sol";
import { GasDropoff, GasDropoffLib } from "./assets/GasDropoff.sol";
import { FeeParams } from "./assets/FeeParams.sol";
//import "./assets/Message.sol";
import { QueryType, ImmutableType } from "./assets/SwapLayerQuery.sol";
import {
  FAST_TRANSFER_MAX_FEE_SIZE,
  FAST_TRANSFER_DEADLINE_SIZE,
  RELAY_GAS_DROPOFF_SIZE,
  RELAY_MAX_RELAYER_FEE_SIZE,
  TransferMode,
  RedeemMode,
  IoToken,
  AcquireMode
} from "./assets/InitiateParams.sol";
import { AttestationType } from "./assets/SwapLayerRedeem.sol";
import { ISwapLayer } from "./ISwapLayer.sol";

//written in a way to avoid memory allocations as much as possible, hence some repetitive passages
abstract contract SwapLayerIntegrationBase {
  using BytesParsing for bytes;
  using { toUniversalAddress } for address;

  error InvalidPathParams();
  error ExceedsMaximum(uint256 value, uint256 maximum);

  enum EvmSwapType {
    UniswapV3,
    TraderJoe
  }

  struct TargetParams {
    uint16 chainId;
    bytes32 recipient;
  }

  struct FastTransferParams {
    uint maxFastFeeUsdc;
    uint auctionDeadline;
  }

  struct RelayParams {
    uint gasDropoffWei;
    uint maxRelayerFeeUsdc;
  }

  struct EvmSwapParams {
    uint256     swapDeadline;
    uint256     limitAmount;
    EvmSwapType swapType;
    //the path must be:
    // * either full, i.e. (tokenAddr, poolId, token, poolId, ..., token)
    // * or the first and last token are stripped, i.e. (poolId, token, ..., poolId)
    //the latter is possible because the first and last token are known
    bytes       path;
  }

  struct SolanaSwapParams {
    uint256 swapDeadline;
    uint256 limitAmount;
  }

  function _swapLayer() virtual internal view returns (ISwapLayer);

  // -----------------------------------------------------------------------------------------------
  // ------------------------------------------ Encoding -------------------------------------------
  // -----------------------------------------------------------------------------------------------

  function _swapLayerEncodeOutputParamsUsdc() internal pure returns (bytes memory) {
    return abi.encodePacked(IoToken.Usdc);
  }

  function _swapLayerEncodeOutputParamsNative(
    EvmSwapParams memory params
  ) internal pure returns (bytes memory) {
    return abi.encodePacked(
      IoToken.Gas,
      _encodeSwapParams(params)
    );
  }

  function _swapLayerEncodeOutputParamsToken(
    address outputToken,
    EvmSwapParams memory params
  ) internal pure returns (bytes memory) {
    return abi.encodePacked(
      IoToken.Other,
      outputToken.toUniversalAddress(),
      _encodeSwapParams(params)
    );
  }

  function _swapLayerEncodeOutputParamsNative(
    SolanaSwapParams memory params
  ) internal pure returns (bytes memory) {
    return abi.encodePacked(
      IoToken.Gas,
      _encodeSharedSwapParams(params.swapDeadline, params.limitAmount),
      SWAP_TYPE_GENERIC_SOLANA
    );
  }

  function _swapLayerEncodeOutputParamsToken(
    bytes32 outputTokenMint,
    SolanaSwapParams memory params
  ) internal pure returns (bytes memory) {
    return abi.encodePacked(
      IoToken.Other,
      outputTokenMint,
      _encodeSharedSwapParams(params.swapDeadline, params.limitAmount),
      SWAP_TYPE_GENERIC_SOLANA
    );
  }

  // -----------------------------------------------------------------------------------------------
  // ---------------------------------------- Initiate Slow ----------------------------------------
  // -----------------------------------------------------------------------------------------------

  // ------------------------ Initiate Slow Direct ------------------------

  struct InitiateNative {
    TargetParams  targetParams;
    uint256       amount; //wormhole message fee is taken from this amount too
    bool          isExactIn;
    EvmSwapParams evmSwapParams;
    bytes         outputParams;
  }

  function _swapLayerInitiate(
    InitiateNative memory params
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    return _initiateSlow(
      params.amount,
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        uint8(TransferMode.LiquidityLayer),
        uint8(RedeemMode.Direct),
        _encodeBool(params.isExactIn),
        uint8(IoToken.Gas),
        _encodeSwapParams(params.evmSwapParams, true, _swapLayerWrappedNative(), _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  struct InitiateUsdc {
    TargetParams  targetParams;
    uint256       amount;
    bytes         outputParams;
  }

  function _swapLayerInitiate(
    InitiateUsdc memory params
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    return _initiateSlow(
      _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        uint8(TransferMode.LiquidityLayer),
        uint8(RedeemMode.Direct),
        _encodeBool(false), //isExactIn - irrelevant
        _encodeUsdcIn(params.amount),
        params.outputParams
      )
    );
  }

  struct InitiateToken {
    TargetParams  targetParams;
    uint256       amount;
    bool          isExactIn;
    address       inputToken;
    EvmSwapParams evmSwapParams;
    bytes         outputParams;
  }

  function _swapLayerInitiate(
    InitiateToken memory params
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    return _initiateSlow(
      _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        uint8(TransferMode.LiquidityLayer),
        uint8(RedeemMode.Direct),
        _encodeBool(params.isExactIn),
        _encodeTokenIn(params.inputToken),
        _encodeAmountPreapproved(params.amount),
        _encodeSwapParams(params.evmSwapParams, true, params.inputToken, _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  // ------------------------ Initiate Slow Relay ------------------------

  struct InitiateRelayNative {
    TargetParams  targetParams;
    RelayParams   relayParams;
    uint256       amount; //wormhole message fee is taken from this amount too
    bool          isExactIn;
    EvmSwapParams evmSwapParams;
    bytes         outputParams;
  }

  function _swapLayerInitiate(
    InitiateRelayNative memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint256 relayingFeeUsdc
  ) {
    return _initiateRelaySlow(
      params.amount,
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        uint8(TransferMode.LiquidityLayer),
        _encodeRelayParams(params.relayParams),
        _encodeBool(params.isExactIn),
        uint8(IoToken.Gas),
        _encodeSwapParams(params.evmSwapParams, true, _swapLayerWrappedNative(), _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  struct InitiateRelayUsdc {
    TargetParams  targetParams;
    RelayParams   relayParams;
    uint256       amount;
    bool          isExactIn;
    bytes         outputParams;
  }

  function _swapLayerInitiate(
    InitiateRelayUsdc memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint256 relayingFeeUsdc
  ) {
    return _initiateRelaySlow(
      _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        uint8(TransferMode.LiquidityLayer),
        _encodeRelayParams(params.relayParams),
        _encodeBool(params.isExactIn),
        _encodeUsdcIn(params.amount),
        params.outputParams
      )
    );
  }

  struct InitiateRelayToken {
    TargetParams  targetParams;
    RelayParams   relayParams;
    uint256       amount;
    bool          isExactIn;
    address       inputToken;
    EvmSwapParams evmSwapParams;
    bytes         outputParams;
  }

  function _swapLayerInitiate(
    InitiateRelayToken memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint256 relayingFeeUsdc
  ) {
    return _initiateRelaySlow(
      _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        uint8(TransferMode.LiquidityLayer),
        _encodeRelayParams(params.relayParams),
        _encodeBool(params.isExactIn),
        _encodeTokenIn(params.inputToken),
        _encodeAmountPreapproved(params.amount),
        _encodeSwapParams(params.evmSwapParams, true, params.inputToken, _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  // ------------------------ Initiate Slow Payload ------------------------

  struct InitiatePayloadNative {
    TargetParams  targetParams;
    bytes         payload;
    uint256       amount; //wormhole message fee is taken from this amount too
    bool          isExactIn;
    EvmSwapParams evmSwapParams;
    bytes         outputParams;
  }

  function _swapLayerInitiate(
    InitiatePayloadNative memory params
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    return _initiateSlow(
      params.amount,
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        uint8(TransferMode.LiquidityLayer),
        _encodePayloadParams(params.payload),
        _encodeBool(params.isExactIn),
        uint8(IoToken.Gas),
        _encodeSwapParams(params.evmSwapParams, true, _swapLayerWrappedNative(), _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  struct InitiatePayloadUsdc {
    TargetParams  targetParams;
    bytes         payload;
    uint256       amount;
    bytes         outputParams;
  }

  function _swapLayerInitiate(
    InitiatePayloadUsdc memory params
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    return _initiateSlow(
      _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        uint8(TransferMode.LiquidityLayer),
        _encodePayloadParams(params.payload),
        _encodeBool(false), //isExactIn - irrelevant
        _encodeUsdcIn(params.amount),
        params.outputParams
      )
    );
  }

  struct InitiatePayloadToken {
    TargetParams  targetParams;
    bytes         payload;
    uint256       amount;
    bool          isExactIn;
    address       inputToken;
    EvmSwapParams evmSwapParams;
    bytes         outputParams;
  }

  function _swapLayerInitiate(
    InitiatePayloadToken memory params
  ) internal returns (uint64 sentAmountUsdc, uint64 sequence, uint256 protocolSequence) {
    return _initiateSlow(
      _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        uint8(TransferMode.LiquidityLayer),
        _encodePayloadParams(params.payload),
        _encodeBool(params.isExactIn),
        _encodeTokenIn(params.inputToken),
        _encodeAmountPreapproved(params.amount),
        _encodeSwapParams(params.evmSwapParams, true, params.inputToken, _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  // -----------------------------------------------------------------------------------------------
  // ---------------------------------------- Initiate Fast ----------------------------------------
  // -----------------------------------------------------------------------------------------------

  // ------------------------ Initiate Fast Direct ------------------------

  struct InitiateNativeFast {
    TargetParams       targetParams;
    FastTransferParams fastTransferParams;
    uint256            amount; //wormhole message fee is taken from this amount too
    bool               isExactIn;
    EvmSwapParams      evmSwapParams;
    bytes              outputParams;
  }

  function _swapLayerInitiate(
    InitiateNativeFast memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    return _initiateFast(
      params.amount,
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        _encodeFastTransferParams(params.fastTransferParams),
        uint8(RedeemMode.Direct),
        _encodeBool(params.isExactIn),
        uint8(IoToken.Gas),
        _encodeSwapParams(params.evmSwapParams, true, _swapLayerWrappedNative(), _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  struct InitiateUsdcFast {
    TargetParams       targetParams;
    FastTransferParams fastTransferParams;
    uint256            amount;
    bool               isExactIn;
    bytes              outputParams;
  }

  function _swapLayerInitiate(
    InitiateUsdcFast memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    return _initiateFast(
      2 * _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        _encodeFastTransferParams(params.fastTransferParams),
        uint8(RedeemMode.Direct),
        _encodeBool(params.isExactIn),
        _encodeUsdcIn(params.amount),
        params.outputParams
      )
    );
  }

  struct InitiateTokenFast {
    TargetParams       targetParams;
    FastTransferParams fastTransferParams;
    uint256            amount;
    bool               isExactIn;
    address            inputToken;
    EvmSwapParams      evmSwapParams;
    bytes              outputParams;
  }

  function _swapLayerInitiate(
    InitiateTokenFast memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    return _initiateFast(
      2 * _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        _encodeFastTransferParams(params.fastTransferParams),
        uint8(RedeemMode.Direct),
        _encodeBool(params.isExactIn),
        _encodeTokenIn(params.inputToken),
        _encodeAmountPreapproved(params.amount),
        _encodeSwapParams(params.evmSwapParams, true, params.inputToken, _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  // ------------------------ Initiate Fast Relay ------------------------

 struct InitiateNativeRelayFast {
    TargetParams       targetParams;
    FastTransferParams fastTransferParams;
    RelayParams        relayParams;
    uint256            amount; //wormhole message fee is taken from this amount too
    bool               isExactIn;
    EvmSwapParams      evmSwapParams;
    bytes              outputParams;
  }

  function _swapLayerInitiate(
    InitiateNativeRelayFast memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    return _initiateFast(
      params.amount,
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        _encodeFastTransferParams(params.fastTransferParams),
        _encodeRelayParams(params.relayParams),
        _encodeBool(params.isExactIn),
        uint8(IoToken.Gas),
        _encodeSwapParams(params.evmSwapParams, true, _swapLayerWrappedNative(), _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  struct InitiateUsdcRelayFast {
    TargetParams       targetParams;
    FastTransferParams fastTransferParams;
    RelayParams        relayParams;
    uint256            amount;
    bool               isExactIn;
    bytes              outputParams;
  }

  function _swapLayerInitiate(
    InitiateUsdcRelayFast memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    return _initiateFast(
      2 * _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        _encodeFastTransferParams(params.fastTransferParams),
        _encodeRelayParams(params.relayParams),
        _encodeBool(params.isExactIn),
        _encodeUsdcIn(params.amount),
        params.outputParams
      )
    );
  }

  struct InitiateTokenRelayFast {
    TargetParams       targetParams;
    FastTransferParams fastTransferParams;
    RelayParams        relayParams;
    uint256            amount;
    bool               isExactIn;
    address            inputToken;
    EvmSwapParams      evmSwapParams;
    bytes              outputParams;
  }

  function _swapLayerInitiate(
    InitiateTokenRelayFast memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    return _initiateFast(
      2 * _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        _encodeFastTransferParams(params.fastTransferParams),
        _encodeRelayParams(params.relayParams),
        _encodeBool(params.isExactIn),
        _encodeTokenIn(params.inputToken),
        _encodeAmountPreapproved(params.amount),
        _encodeSwapParams(params.evmSwapParams, true, params.inputToken, _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  // ------------------------ Initiate Fast Payload ------------------------

  struct InitiateNativePayloadFast {
    TargetParams       targetParams;
    FastTransferParams fastTransferParams;
    bytes              payload;
    uint256            amount; //wormhole message fee is taken from this amount too
    bool               isExactIn;
    EvmSwapParams      evmSwapParams;
    bytes              outputParams;
  }

  function _swapLayerInitiate(
    InitiateNativePayloadFast memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    return _initiateFast(
      params.amount,
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        _encodeFastTransferParams(params.fastTransferParams),
        _encodePayloadParams(params.payload),
        _encodeBool(params.isExactIn),
        uint8(IoToken.Gas),
        _encodeSwapParams(params.evmSwapParams, true, _swapLayerWrappedNative(), _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  struct InitiateUsdcPayloadFast {
    TargetParams       targetParams;
    FastTransferParams fastTransferParams;
    bytes              payload;
    uint256            amount;
    bool               isExactIn;
    bytes              outputParams;
  }

  function _swapLayerInitiate(
    InitiateUsdcPayloadFast memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    return _initiateFast(
      2 * _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        _encodeFastTransferParams(params.fastTransferParams),
        _encodePayloadParams(params.payload),
        _encodeBool(params.isExactIn),
        _encodeUsdcIn(params.amount),
        params.outputParams
      )
    );
  }

  struct InitiateTokenPayloadFast {
    TargetParams       targetParams;
    FastTransferParams fastTransferParams;
    bytes              payload;
    uint256            amount;
    bool               isExactIn;
    address            inputToken;
    EvmSwapParams      evmSwapParams;
    bytes              outputParams;
  }

  function _swapLayerInitiate(
    InitiateTokenPayloadFast memory params
  ) internal returns (
    uint64 sentAmountUsdc,
    uint64 sequence,
    uint256 protocolSequence,
    uint64 fastSequence
  ) {
    return _initiateFast(
      2 * _wormholeMsgFee(),
      params.targetParams.chainId,
      params.targetParams.recipient,
      abi.encodePacked(
        _encodeFastTransferParams(params.fastTransferParams),
        _encodePayloadParams(params.payload),
        _encodeBool(params.isExactIn),
        _encodeTokenIn(params.inputToken),
        _encodeAmountPreapproved(params.amount),
        _encodeSwapParams(params.evmSwapParams, true, params.inputToken, _swapLayerUsdc()),
        params.outputParams
      )
    );
  }

  // -----------------------------------------------------------------------------------------------
  // ------------------------------------------- Redeem --------------------------------------------
  // -----------------------------------------------------------------------------------------------

  function _swapLayerRedeem(
    bytes memory attestation //TODO figure out how to generate as calldata in tests
  ) internal returns (address outputToken, uint256 outputAmount) {
    return abi.decode(
      _swapLayer().redeem(uint8(AttestationType.LiquidityLayer), attestation, new bytes(0)),
      (address, uint256)
    );
  }

  function _swapLayerRedeemWithPayload(
    bytes memory attestation //TODO figure out how to generate as calldata in tests
  ) internal returns (address outputToken, uint256 outputAmount, bytes memory payload) {
    return abi.decode(
      _swapLayer().redeem(uint8(AttestationType.LiquidityLayer), attestation, new bytes(0)),
      (address, uint256, bytes)
    );
  }

  function _swapLayerRedeem(
    bytes memory attestation, //TODO figure out how to generate as calldata in tests
    bytes memory outputSwap
  ) internal returns (address outputToken, uint256 outputAmount) {
    return abi.decode(
      _swapLayer().redeem(uint8(AttestationType.LiquidityLayer), attestation, outputSwap),
      (address, uint256)
    );
  }

  function _swapLayerRedeemWithPayload(
    bytes memory attestation, //TODO figure out how to generate as calldata in tests
    bytes memory outputSwap
  ) internal returns (address outputToken, uint256 outputAmount, bytes memory payload) {
    return abi.decode(
      _swapLayer().redeem(uint8(AttestationType.LiquidityLayer), attestation, outputSwap),
      (address, uint256, bytes)
    );
  }

  // -----------------------------------------------------------------------------------------------
  // --------------------------------------- Getters & Utils ---------------------------------------
  // -----------------------------------------------------------------------------------------------

  // ---- Mutable Getters ----

  function _swapLayerFeeParams(uint16 chainId) internal view returns (FeeParams) {
    (uint256 params, ) = _swapLayer().batchQueries(abi.encodePacked(
      uint8(QueryType.FeeParams),
      chainId
    )).asUint256Unchecked(0);
    return FeeParams.wrap(params);
  }

  function _swapLayerPeer(uint16 chainId) internal view returns (bytes32 universalAddr) {
    (universalAddr, ) = _swapLayer().batchQueries(abi.encodePacked(
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

  function _swapLayerWormhole() virtual internal view returns (address) {
    return _getImmutable(ImmutableType.Wormhole);
  }

  function _swapLayerUsdc() virtual internal view returns (address) {
    return _getImmutable(ImmutableType.Usdc);
  }

  function _swapLayerWrappedNative() virtual internal view returns (address) {
    return _getImmutable(ImmutableType.WrappedNative);
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

  function _wormholeMsgFee() virtual internal view returns (uint256) {
    return IWormhole(_swapLayerWormhole()).messageFee();
  }

  function _checkMax(uint256 val, uint256 max) internal pure {
    if (val > max)
      revert ExceedsMaximum(val, max);
  }

  // -----------------------------------------------------------------------------------------------
  // ------------------------------------------- Private -------------------------------------------
  // -----------------------------------------------------------------------------------------------

  function _encodeFastTransferParams(
    FastTransferParams memory params
  ) private pure returns (uint88) {
    _checkMax(params.maxFastFeeUsdc, type(uint48).max);
    _checkMax(params.auctionDeadline, type(uint32).max);

    return uint88(((
      uint(TransferMode.LiquidityLayerFast)
      <<  FAST_TRANSFER_MAX_FEE_SIZE * 8) + params.maxFastFeeUsdc
      << FAST_TRANSFER_DEADLINE_SIZE * 8) + params.auctionDeadline
    );
  }

  function _encodeRelayParams(RelayParams memory params) private pure returns (uint88) {
    _checkMax(params.maxRelayerFeeUsdc, type(uint48).max);

    uint gasDropoff = uint(GasDropoff.unwrap(GasDropoffLib.to(params.gasDropoffWei)));
    return uint88(((
      uint(RedeemMode.Relay)
      <<     RELAY_GAS_DROPOFF_SIZE * 8) + gasDropoff
      << RELAY_MAX_RELAYER_FEE_SIZE * 8) + params.maxRelayerFeeUsdc
    );
  }

  function _encodePayloadParams(
    bytes memory payload
  ) private pure returns (bytes memory) {
    return abi.encodePacked(uint8(RedeemMode.Payload), uint32(payload.length), payload);
  }

  function _encodeUsdcIn(uint amount) private pure returns (uint144) {
    return uint144((
      uint(IoToken.Usdc)
      << (SWAP_PARAM_AMOUNT_SIZE + MODE_SIZE) * 8) + uint(_encodeAmountPreapproved(amount))
    );
  }

  function _encodeTokenIn(address inputToken) private pure returns (uint16) {
    return uint16(((
      uint(IoToken.Other)
      <<    BOOL_SIZE * 8) + _encodeBool(true) //approveCheck
      << ADDRESS_SIZE * 8) + uint(uint160(inputToken))
    );
  }

  function _encodeAmountPreapproved(uint amount) private pure returns (uint136) {
    return uint136((
      _encodeAmount(amount)
      << MODE_SIZE * 8) + uint(AcquireMode.Preapproved)
    );
  }

  function _encodeSwapParams(
    EvmSwapParams memory params
  ) private pure returns (bytes memory) {
    return _encodeSwapParams(params, false, address(0), address(0));
  }

  function _encodeSwapParams(
    EvmSwapParams memory params,
    bool checkTokens,
    address fromToken,
    address toToken
  ) private pure returns (bytes memory) { unchecked {
    uint startOffset = _swapPathStartOffset(params.path, checkTokens, fromToken, toToken);
    (uint24 firstPoolId, uint offset) = params.path.asUint24Unchecked(startOffset);
    uint pathLength = (params.path.length - startOffset) / SHARED_PATH_ELEMENT_SIZE;
    _checkMax(pathLength, type(uint8).max);
    (bytes memory finalPath, ) =
      params.path.sliceUnchecked(offset, pathLength * SHARED_PATH_ELEMENT_SIZE);

    return abi.encodePacked(
      _encodeSharedSwapParams(params.swapDeadline, params.limitAmount),
      params.swapType == EvmSwapType.UniswapV3 ? SWAP_TYPE_UNISWAPV3 : SWAP_TYPE_TRADERJOE,
      firstPoolId,
      uint8(pathLength),
      finalPath
    );
  }}

  function _encodeSharedSwapParams(
    uint swapDeadline,
    uint limitAmount
  ) private pure returns (uint160) {
    _checkMax(swapDeadline, type(uint32).max);
    return uint160((swapDeadline << SWAP_PARAM_AMOUNT_SIZE * 8) + _encodeAmount(limitAmount));
  }

  function _swapPathStartOffset(
    bytes memory path,
    bool checkTokens,
    address fromToken,
    address toToken
  ) private pure returns (uint) { unchecked {
    if (path.length == SHARED_POOL_ID_SIZE)
      return 0;

    if (path.length >= SHARED_PATH_ELEMENT_SIZE) {
      if ((path.length - SHARED_POOL_ID_SIZE) % SHARED_PATH_ELEMENT_SIZE == 0)
        return 0;

      if ((path.length - ADDRESS_SIZE) % SHARED_PATH_ELEMENT_SIZE == 0) {
        if (!checkTokens)
          return ADDRESS_SIZE;

        (address encodedFromToken, ) = path.asAddressUnchecked(0);
        (address encodedToToken, )   = path.asAddressUnchecked(path.length - ADDRESS_SIZE);
        if (encodedFromToken == fromToken && encodedToToken == toToken)
          return ADDRESS_SIZE;
      }
    }
    revert InvalidPathParams();
  }}

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
    (addr, ) = _swapLayer().batchQueries(query).asAddressUnchecked(0);
  }

  function _initiateSlow(
    uint256 msgValue,
    uint16 targetChain,
    bytes32 recipient,
    bytes memory params
  ) private returns (uint64, uint64, uint256) {
    return abi.decode(
      _swapLayer().initiate{value: msgValue}(targetChain, recipient, params),
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
      _swapLayer().initiate{value: msgValue}(targetChain, recipient, params),
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
      _swapLayer().initiate{value: msgValue}(targetChain, recipient, params),
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
      _swapLayer().initiate{value: msgValue}(targetChain, recipient, params),
      (uint64, uint64, uint256, uint64, uint64)
    );
  }
}
