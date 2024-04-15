// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "wormhole-sdk/libraries/BytesParsing.sol";

import { InvalidChainId, SwapLayerBase } from "./SwapLayerBase.sol";
import { Percentage, PercentageLib } from "./Percentage.sol";
import { GasPrice, GasPriceLib } from "./GasPrice.sol";
import { GasDropoff, GasDropoffLib } from "./GasDropoff.sol";
import { IoTokenMOS } from "./InitiateParams.sol";
import {
  ADDRESS_SIZE,
  SWAP_TYPE_UNISWAPV3,
  SWAP_TYPE_TRADERJOE,
  SWAP_TYPE_GENERIC_SOLANA,
  IoToken,
  parseSwapTypeAndCount
} from "./Params.sol";


//store everything in one slot and make reads and writes cheap (no struct in memory nonsense)
type FeeParams is uint256;
library FeeParamsLib {
  // layout (low to high bits - i.e. in packed struct order) - unit:
  //  4 bytes baseFee                 - atomic usdc (i.e. 6 decimals -> 1e6 = 1 usdc), max=disabled
  //  4 bytes gasPrice                - wei/gas (see GasPrice)
  //  2 bytes gasPriceMargin          - scalar (see Percentage)
  //  4 bytes gasPriceTimestamp       - unix timestamp (seconds, like block.timestamp)
  //  2 bytes gasPriceUpdateThreshold - scalar (see Percentage)
  //  4 bytes maxGasDropoff           - wei (see GasDropoff)
  //  4 bytes gasDropoffMargin        - scalar (see Percentage)
  // 10 bytes gasTokenPrice           - atomic usdc/token (e.g. 1e9 = 1000 usdc/ether (or sol))
  //
  // note: just 4 bytes would be enough to accurately represent gas token prices in usdc
  //  a 27/5 bit split gives 8 digits of precision and a max value of:
  //    1e2 (8 digit mantissa in usdc) * 1e31 (max exponent) = 1e33
  // an alternative for the gas token price would be to use an on-chain oracle to look
  //   up the price as needed (if available)

  uint256 private constant BASE_FEE_SIZE = 32;
  uint256 private constant BASE_FEE_OFFSET = 0;
  uint256 private constant BASE_FEE_WRITE_MASK =
    ~(((1 << BASE_FEE_SIZE) - 1) << BASE_FEE_OFFSET);

  uint256 private constant GAS_PRICE_SIZE = GasPriceLib.BYTE_SIZE * 8;
  uint256 private constant GAS_PRICE_OFFSET =
    BASE_FEE_OFFSET + BASE_FEE_SIZE;
  uint256 private constant GAS_PRICE_WRITE_MASK =
    ~(((1 << GAS_PRICE_SIZE) - 1) << GAS_PRICE_OFFSET);

  uint256 private constant GAS_PRICE_MARGIN_SIZE = PercentageLib.BYTE_SIZE * 8;
  uint256 private constant GAS_PRICE_MARGIN_OFFSET =
    GAS_PRICE_OFFSET + GAS_PRICE_SIZE;
  uint256 private constant GAS_PRICE_MARGIN_WRITE_MASK =
    ~(((1 << GAS_PRICE_MARGIN_SIZE) - 1) << GAS_PRICE_MARGIN_OFFSET);

  uint256 private constant GAS_PRICE_TIMESTAMP_SIZE = 32;
  uint256 private constant GAS_PRICE_TIMESTAMP_OFFSET =
    GAS_PRICE_MARGIN_OFFSET + GAS_PRICE_MARGIN_SIZE;
  uint256 private constant GAS_PRICE_TIMESTAMP_WRITE_MASK =
    ~(((1 << GAS_PRICE_TIMESTAMP_SIZE) - 1) << GAS_PRICE_TIMESTAMP_OFFSET);

  uint256 private constant GAS_PRICE_UPDATE_THRESHOLD_SIZE = PercentageLib.BYTE_SIZE * 8;
  uint256 private constant GAS_PRICE_UPDATE_THRESHOLD_OFFSET =
    GAS_PRICE_TIMESTAMP_OFFSET + GAS_PRICE_TIMESTAMP_SIZE;
  uint256 private constant GAS_PRICE_UPDATE_THRESHOLD_WRITE_MASK =
    ~(((1 << GAS_PRICE_UPDATE_THRESHOLD_SIZE) - 1) << GAS_PRICE_UPDATE_THRESHOLD_OFFSET);

  uint256 private constant MAX_GAS_DROPOFF_SIZE = GasDropoffLib.BYTE_SIZE * 8;
  uint256 private constant MAX_GAS_DROPOFF_OFFSET =
    GAS_PRICE_UPDATE_THRESHOLD_OFFSET + GAS_PRICE_UPDATE_THRESHOLD_SIZE;
  uint256 private constant MAX_GAS_DROPOFF_WRITE_MASK =
    ~(((1 << MAX_GAS_DROPOFF_SIZE) - 1) << MAX_GAS_DROPOFF_OFFSET);

  uint256 private constant GAS_DROPOFF_MARGIN_SIZE = PercentageLib.BYTE_SIZE * 8;
  uint256 private constant GAS_DROPOFF_MARGIN_OFFSET =
    MAX_GAS_DROPOFF_OFFSET + MAX_GAS_DROPOFF_SIZE;
  uint256 private constant GAS_DROPOFF_MARGIN_WRITE_MASK =
    ~(((1 << GAS_DROPOFF_MARGIN_SIZE) - 1) << GAS_DROPOFF_MARGIN_OFFSET);

  uint256 private constant GAS_TOKEN_PRICE_SIZE = 80;
  uint256 private constant GAS_TOKEN_PRICE_OFFSET =
    GAS_DROPOFF_MARGIN_OFFSET + GAS_DROPOFF_MARGIN_SIZE;
  uint256 private constant GAS_TOKEN_PRICE_WRITE_MASK =
    ~(((1 << GAS_TOKEN_PRICE_SIZE) - 1) << GAS_TOKEN_PRICE_OFFSET);

  function checkedWrap(uint256 value) internal pure returns (FeeParams) { unchecked {
    FeeParams params = FeeParams.wrap(value);

    //check percentage fields (they are the only ones that have a constraint)
    PercentageLib.checkedWrap(Percentage.unwrap(gasPriceMargin(params)));
    PercentageLib.checkedWrap(Percentage.unwrap(gasPriceUpdateThreshold(params)));
    PercentageLib.checkedWrap(Percentage.unwrap(gasDropoffMargin(params)));

    return params;
  }}

  function baseFee(FeeParams params) internal pure returns (uint) { unchecked {
    return uint32(FeeParams.unwrap(params) >> BASE_FEE_OFFSET);
  }}

  function baseFee(
    FeeParams params,
    uint32 baseFee_
  ) internal pure returns (FeeParams) { unchecked {
    return FeeParams.wrap(
      (FeeParams.unwrap(params) & BASE_FEE_WRITE_MASK) |
      (uint256(baseFee_) << BASE_FEE_OFFSET)
    );
  }}

  function gasPrice(FeeParams params) internal pure returns (GasPrice) { unchecked {
    return GasPrice.wrap(uint32(FeeParams.unwrap(params) >> GAS_PRICE_OFFSET));
  }}

  function gasPrice(
    FeeParams params,
    GasPrice gasPrice_
  ) internal pure returns (FeeParams) { unchecked {
    return FeeParams.wrap(
      (FeeParams.unwrap(params) & GAS_PRICE_WRITE_MASK) |
      (uint256(GasPrice.unwrap(gasPrice_)) << GAS_PRICE_OFFSET)
    );
  }}

  function gasPriceMargin(FeeParams params) internal pure returns (Percentage) { unchecked {
    return Percentage.wrap(uint16(FeeParams.unwrap(params) >> GAS_PRICE_MARGIN_OFFSET));
  }}

  function gasPriceMargin(
    FeeParams params,
    Percentage gasPriceMargin_
  ) internal pure returns (FeeParams) { unchecked {
    return FeeParams.wrap(
      (FeeParams.unwrap(params) & GAS_PRICE_MARGIN_WRITE_MASK) |
      (uint256(Percentage.unwrap(gasPriceMargin_)) << GAS_PRICE_MARGIN_OFFSET)
    );
  }}

  function gasPriceTimestamp(FeeParams params) internal pure returns (uint32) { unchecked {
    return uint32(FeeParams.unwrap(params) >> GAS_PRICE_TIMESTAMP_OFFSET);
  }}

  function gasPriceTimestamp(
    FeeParams params,
    uint32 gasPriceTimestamp_
  ) internal pure returns (FeeParams) { unchecked {
    return FeeParams.wrap(
      (FeeParams.unwrap(params) & GAS_PRICE_TIMESTAMP_WRITE_MASK) |
      (uint256(gasPriceTimestamp_) << GAS_PRICE_TIMESTAMP_OFFSET)
    );
  }}

  function gasPriceUpdateThreshold(
    FeeParams params
  ) internal pure returns (Percentage) { unchecked {
    return Percentage.wrap(uint16(FeeParams.unwrap(params) >> GAS_PRICE_UPDATE_THRESHOLD_OFFSET));
  }}

  function gasPriceUpdateThreshold(
    FeeParams params,
    Percentage gasPriceUpdateThreshold_
  ) internal pure returns (FeeParams) { unchecked {
    return FeeParams.wrap(
      (FeeParams.unwrap(params) & GAS_PRICE_UPDATE_THRESHOLD_WRITE_MASK) |
      (uint256(Percentage.unwrap(gasPriceUpdateThreshold_)) << GAS_PRICE_UPDATE_THRESHOLD_OFFSET)
    );
  }}

  function maxGasDropoff(FeeParams params) internal pure returns (GasDropoff) { unchecked {
    return GasDropoff.wrap(uint32(FeeParams.unwrap(params) >> MAX_GAS_DROPOFF_OFFSET));
  }}

  function maxGasDropoff(
    FeeParams params,
    GasDropoff maxGasDropoff_
  ) internal pure returns (FeeParams) { unchecked {
    return FeeParams.wrap(
      (FeeParams.unwrap(params) & MAX_GAS_DROPOFF_WRITE_MASK) |
      (uint256(GasDropoff.unwrap(maxGasDropoff_)) << MAX_GAS_DROPOFF_OFFSET)
    );
  }}

  function gasDropoffMargin(FeeParams params) internal pure returns (Percentage) { unchecked {
    return Percentage.wrap(uint16(FeeParams.unwrap(params) >> GAS_DROPOFF_MARGIN_OFFSET));
  }}

  function gasDropoffMargin(
    FeeParams params,
    Percentage gasDropoffMargin_
  ) internal pure returns (FeeParams) { unchecked {
    return FeeParams.wrap(
      (FeeParams.unwrap(params) & GAS_DROPOFF_MARGIN_WRITE_MASK) |
      (uint256(Percentage.unwrap(gasDropoffMargin_)) << GAS_DROPOFF_MARGIN_OFFSET)
    );
  }}

  function gasTokenPrice(FeeParams params) internal pure returns (uint) { unchecked {
    return uint80(FeeParams.unwrap(params) >> GAS_TOKEN_PRICE_OFFSET);
  }}

  function gasTokenPrice(
    FeeParams params,
    uint80 gasTokenPrice_
  ) internal pure returns (FeeParams) { unchecked {
    return FeeParams.wrap(
      (FeeParams.unwrap(params) & GAS_TOKEN_PRICE_WRITE_MASK) |
      (uint256(gasTokenPrice_) << GAS_TOKEN_PRICE_OFFSET)
    );
  }}
}
using FeeParamsLib for FeeParams global;

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
  GasPriceUpdateThreshold,
  GasPriceMargin,
  GasDropoffMargin,
  MaxGasDropoff
  // UpdateMode,
  // UpdateModeData
}

abstract contract SwapLayerRelayingFees is SwapLayerBase {
  using BytesParsing for bytes;

  //TODO this should come from elsewhere
  uint private constant SOLANA_CHAIN_ID = 1;
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
        uint32 gasPriceTimestamp;
        uint32 gasPrice;
        (gasPriceTimestamp, offset) = updates.asUint32Unchecked(offset);
        (gasPrice,          offset) = updates.asUint32Unchecked(offset);
        if (gasPriceTimestamp > curParams.gasPriceTimestamp()) {
          curParams = curParams.gasPriceTimestamp(gasPriceTimestamp);
          curParams = curParams.gasPrice(GasPrice.wrap(gasPrice));
        }
      }
      else if (update == FeeUpdate.GasTokenPrice) {
        uint80 gasTokenPrice;
        (gasTokenPrice, offset) = updates.asUint80Unchecked(offset);
        curParams = curParams.gasTokenPrice(gasTokenPrice);
      }
      else if (update == FeeUpdate.BaseFee) {
        uint32 baseFee;
        (baseFee, offset) = updates.asUint32Unchecked(offset);
        curParams = curParams.baseFee(baseFee);
      }
      else if (update == FeeUpdate.GasPriceUpdateThreshold) {
        uint16 gasPriceUpdateThreshold;
        (gasPriceUpdateThreshold, offset) = updates.asUint16Unchecked(offset);
        curParams = curParams.gasPriceUpdateThreshold(
          PercentageLib.checkedWrap(gasPriceUpdateThreshold)
        );
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
      else { //must be FeeUpdate.MaxGasDropoff
        uint32 maxGasDropoff;
        (maxGasDropoff, offset) = updates.asUint32Unchecked(offset);
        curParams = curParams.maxGasDropoff(GasDropoff.wrap(maxGasDropoff));
      }
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

    uint swapCount = 0;
    uint swapType;
    if (outputMOS.mode != IoToken.Usdc) {
      uint offset = outputMOS.offset;
      if (outputMOS.mode == IoToken.Other)
        offset += ADDRESS_SIZE;

      (swapType, swapCount, ) = parseSwapTypeAndCount(params, offset);
    }

    if (targetChain == SOLANA_CHAIN_ID) {
      //TODO figure out what other dynamic fees might go into Solana fee calculations
      if (swapType != SWAP_TYPE_GENERIC_SOLANA)
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