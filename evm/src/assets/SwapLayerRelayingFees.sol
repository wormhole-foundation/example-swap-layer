// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "wormhole-sdk/libraries/BytesParsing.sol";

import { InvalidChainId, SwapLayerBase } from "./SwapLayerBase.sol";
import { Percentage, PercentageLib } from "./Percentage.sol";
import { GasPrice, GasPriceLib } from "./GasPrice.sol";
import { GasDropoff, GasDropoffLib } from "./GasDropoff.sol";
import { FeeParams, FeeParamsLib } from "./FeeParams.sol";
import { IoTokenMOS } from "./InitiateParams.sol";
import {
  SOLANA_CHAIN_ID,
  UNIVERSAL_ADDRESS_SIZE,
  SWAP_TYPE_UNISWAPV3,
  SWAP_TYPE_TRADERJOE,
  SWAP_TYPE_GENERIC_SOLANA,
  IoToken,
  parseSwapTypeAndCountAndSkipParams
} from "./Params.sol";

struct FeeParamsState {
  // chainId => fee parameters of that chain
  mapping(uint16 => FeeParams) chainMapping;
}

// keccak256("FeeParamsState") - 1
bytes32 constant FEE_PARAMS_STORAGE_SLOT =
  0x390950e512c08746510d8189287f633f84012f0678caa6bc6558847bdd158b23;

function feeParamsState() pure returns (FeeParamsState storage state) {
  assembly ("memory-safe") {
    state.slot := FEE_PARAMS_STORAGE_SLOT
  }
}

error MaxGasDropoffExceeded(uint requested, uint maximum);
error RelayingDisabledForChain();
error InvalidSwapTypeForChain(uint16 chain, uint swapType);

//the additional gas cost is likely worth the cost of being able to reconstruct old fees
event FeeParamsUpdated(uint16 indexed chainId, FeeParams params);

enum FeeUpdate {
  GasPrice,
  GasTokenPrice,
  BaseFee,
  GasPriceMargin,
  GasDropoffMargin,
  MaxGasDropoff
}

abstract contract SwapLayerRelayingFees is SwapLayerBase {
  using BytesParsing for bytes;

  uint private constant SOLANA_ATA_RENT_LAMPORTS = 2039280;
  uint private constant LAMPORTS_PER_SOL = 1e9;
  //uint private constant BIT128 = 1 << 128;
  uint private constant GAS_OVERHEAD = 1e5; //TODO
  uint private constant DROPOFF_GAS_OVERHEAD = 1e4; //TODO
  uint private constant UNISWAP_GAS_OVERHEAD = 1e5; //TODO
  uint private constant UNISWAP_GAS_PER_SWAP = 1e5; //TODO
  uint private constant TRADERJOE_GAS_OVERHEAD = 1e5; //TODO
  uint private constant TRADERJOE_GAS_PER_SWAP = 1e5; //TODO

  function _batchFeeUpdates(bytes memory updates) internal {
    uint16 curChain = 0;
    FeeParams curParams;
    uint offset = 0;
    while (offset < updates.length) {
      uint16 updateChain;
      (updateChain, offset) = updates.asUint16Unchecked(offset);
      if (updateChain == 0)
        revert InvalidChainId();

      if (curChain != updateChain) {
        if (curChain != 0)
          _setFeeParams(curChain, curParams);

        curParams = _getFeeParams(updateChain);
      }

      uint8 update_;
      (update_, offset) = updates.asUint8Unchecked(offset);
      FeeUpdate update = FeeUpdate(update_);
      if (update == FeeUpdate.GasPrice) {
        uint32 gasPrice;
        (gasPrice, offset) = updates.asUint32Unchecked(offset);
        curParams = curParams.gasPrice(GasPrice.wrap(gasPrice));
      }
      else if (update == FeeUpdate.GasTokenPrice) {
        uint64 gasTokenPrice;
        (gasTokenPrice, offset) = updates.asUint64Unchecked(offset);
        curParams = curParams.gasTokenPrice(gasTokenPrice);
      }
      else if (update == FeeUpdate.BaseFee) {
        uint32 baseFee;
        (baseFee, offset) = updates.asUint32Unchecked(offset);
        curParams = curParams.baseFee(baseFee);
      }
      else if (update == FeeUpdate.GasPriceMargin) {
        uint16 gasPriceMargin;
        (gasPriceMargin, offset) = updates.asUint16Unchecked(offset);
        curParams = curParams.gasPriceMargin(PercentageLib.checkedWrap(gasPriceMargin));
      }
      else if (update == FeeUpdate.GasDropoffMargin) {
        uint16 gasDropoffMargin;
        (gasDropoffMargin, offset) = updates.asUint16Unchecked(offset);
        curParams = curParams.gasDropoffMargin(PercentageLib.checkedWrap(gasDropoffMargin));
      }
      else if (update == FeeUpdate.MaxGasDropoff) {
        uint32 maxGasDropoff;
        (maxGasDropoff, offset) = updates.asUint32Unchecked(offset);
        curParams = curParams.maxGasDropoff(GasDropoff.wrap(maxGasDropoff));
      }
      else
        _assertExhaustive();
    }
    updates.checkLength(offset);

    if (curChain != 0)
      _setFeeParams(curChain, curParams);
  }

  function _calcRelayingFee(
    uint16 targetChain,
    GasDropoff gasDropoff_,
    bytes memory params,
    IoTokenMOS memory outputMOS
  ) internal view returns (uint relayerFee) { unchecked {
    FeeParams feeParams = _getFeeParams(targetChain);

    //setting the base fee to uint32 max disables relaying
    if (feeParams.baseFee() == type(uint32).max)
      revert RelayingDisabledForChain();

    relayerFee = feeParams.baseFee();

    uint gasDropoff = gasDropoff_.from();
    if (gasDropoff > 0) {
      uint maxGasDropoff = feeParams.maxGasDropoff().from();
      if (gasDropoff > maxGasDropoff)
        revert MaxGasDropoffExceeded(gasDropoff, maxGasDropoff);

      relayerFee += feeParams.gasDropoffMargin().compound(
        gasDropoff * feeParams.gasTokenPrice()
      ) / 1 ether;
    }

    uint swapType;
    uint swapCount = 0;
    if (outputMOS.mode != IoToken.Usdc) {
      uint offset = outputMOS.offset;
      if (outputMOS.mode == IoToken.Other)
        offset += UNIVERSAL_ADDRESS_SIZE;

      (swapType, swapCount, ) = parseSwapTypeAndCountAndSkipParams(params, offset);
    }

    if (targetChain == SOLANA_CHAIN_ID) {
      //TODO figure out what other (dynamic) fees might go into Solana fee calculations
      if (swapCount != 0 && swapType != SWAP_TYPE_GENERIC_SOLANA)
        revert InvalidSwapTypeForChain(targetChain, swapType);

      //add the cost of ATA rent for non-gas tokens
      if (outputMOS.mode == IoToken.Other)
        relayerFee += feeParams.gasDropoffMargin().compound(
          SOLANA_ATA_RENT_LAMPORTS * feeParams.gasTokenPrice()
        ) / LAMPORTS_PER_SOL;
    }
    else { //EVM chains
      uint totalGas = GAS_OVERHEAD;
      if (gasDropoff > 0)
        totalGas += DROPOFF_GAS_OVERHEAD;

      if (swapCount != 0) {
        uint overhead;
        uint gasPerSwap;
        if (swapType == SWAP_TYPE_UNISWAPV3)
          (overhead, gasPerSwap) = (  UNISWAP_GAS_OVERHEAD,   UNISWAP_GAS_PER_SWAP);
        else if (swapType == SWAP_TYPE_TRADERJOE)
          (overhead, gasPerSwap) = (TRADERJOE_GAS_OVERHEAD, TRADERJOE_GAS_PER_SWAP);
        else
          revert InvalidSwapTypeForChain(targetChain, swapType);

        totalGas += overhead + gasPerSwap * swapCount;
      }

      relayerFee += feeParams.gasPriceMargin().compound(
        totalGas * feeParams.gasPrice().from() * feeParams.gasTokenPrice()
      ) / 1 ether;
    }
  }}

  function _getFeeParams(uint16 chainId) internal view returns (FeeParams) {
    return feeParamsState().chainMapping[chainId];
  }

  function _setFeeParams(uint16 chainId, FeeParams params) internal {
    feeParamsState().chainMapping[chainId] = params;
    emit FeeParamsUpdated(chainId, params);
  }
}

// ---- unused code to use uniswap v3 pools as oracles for token prices ----

// interface IUniswapV3Pool {
//   function slot0() external view returns (
//     uint160 sqrtPriceX96,
//     int24 tick,
//     uint16 observationIndex,
//     uint16 observationCardinality,
//     uint16 observationCardinalityNext,
//     uint8 feeProtocol,
//     bool unlocked
//   );
// }

// bytes32 constant UNISWAP_POOL_CODE_HASH =
//   0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54;

// contract SwapLayerRelayingFees is SwapLayerBase {
//   //true if the gas token (=wnative) is the first token in the (token0, token1) pair
//   //  otherwise false
//   //uniswap V3 represents prices as token1 per token0
//   //so if the gas token is token0, we need to invert the price
//   bool    private immutable uniswapGasTokenIsFirst_;
//   address private immutable uniswapFactory_;

//   constructor(IERC20 usdc, IWETH wnative, address uniswapFactory) {
//     uniswapGasTokenIsFirst_ = address(wnative) < address(usdc);
//     uniswapFactory_ = uniswapFactory;
//   }

// function calcGasTokenUsdcPrice(uint24 uniswapFee) private view returns (uint) {
//   (uint160 sqrtPriceX96,,,,,,) = uniswapPool.slot0();

//   uint256 uniswapPrice;
//   uint fractionalBits;
//   if (sqrtPriceX96 < BIT128) {
//     //if sqrtPriceX96 takes less than 16 bytes we can safely square it
//     uniswapPrice = uint(sqrtPriceX96) * uint(sqrtPriceX96);
//     fractionalBits = 192;
//   }
//   else {
//     //if sqrtPriceX96 takes between 16 and 20 bytes, we rightshift by 32 before squaring
//     uniswapPrice = sqrtPriceX96 >> 32;
//     uniswapPrice = uniswapPrice * uniswapPrice;
//     fractionalBits = 128;
//   }
// }

// function getUniV3GasPrice(uint24 uniswapFee) private view returns (uint) {
//   uint uniswapPrice = uniswapGasTokenPriceOracle(uniswapFee);
//   return uniswapGasTokenIsFirst_ ? uniswapPrice : BIT256 / uniswapPrice;
// }

//   function uniswapGasTokenPriceOracle(uint24 uniswapFee) private view returns (IUniswapV3Pool) {
//     (address token0, address token1) =
//       uniswapGasTokenIsFirst_
//       ? (address(wnative_), address(usdc_))
//       : (address(usdc_), address(wnative_));

//     return IUniswapV3Pool(address(uint160(uint256(
//       keccak256( //calculate CREATE2 address
//         abi.encodePacked(
//           0xff,
//           uniswapFactory_,
//           keccak256(abi.encode(token0, token1, uniswapFee)), //salt
//           UNISWAP_POOL_CODE_HASH
//         )
//       )
//     ))));
//   }