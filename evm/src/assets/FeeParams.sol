// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { Percentage, PercentageLib } from "./Percentage.sol";
import {   GasPrice,   GasPriceLib } from "./GasPrice.sol";
import { GasDropoff, GasDropoffLib } from "./GasDropoff.sol";

//store everything in one slot and make reads and writes cheap (no struct in memory nonsense)
type FeeParams is uint256;
library FeeParamsLib {
  // layout (low to high bits - i.e. in packed struct order) - unit:
  //  4 bytes baseFee                 - atomic usdc (i.e. 6 decimals -> 1e6 = 1 usdc), max=disabled
  //  4 bytes gasPrice                - wei/gas (see GasPrice)
  //  2 bytes gasPriceMargin          - scalar (see Percentage)
  //  4 bytes maxGasDropoff           - wei (see GasDropoff)
  //  2 bytes gasDropoffMargin        - scalar (see Percentage)
  //  8 bytes gasTokenPrice           - atomic usdc/token (e.g. 1e9 = 1000 usdc/ether (or sol))
  //  8 bytes currently unused
  //
  // note: just 4 bytes would be enough to accurately represent gas token prices in usdc
  //  a 27/5 bit split gives 8 digits of precision and a max value of:
  //    1e2 (8 digit mantissa in usdc) * 1e31 (max exponent) = 1e33
  // an alternative for the gas token price would be to use an on-chain oracle to look
  //   up the price as needed (if available)

  uint256 private constant BASE_FEE_SIZE = 4 * 8;
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

  uint256 private constant MAX_GAS_DROPOFF_SIZE = GasDropoffLib.BYTE_SIZE * 8;
  uint256 private constant MAX_GAS_DROPOFF_OFFSET =
    GAS_PRICE_MARGIN_OFFSET + GAS_PRICE_MARGIN_SIZE;
  uint256 private constant MAX_GAS_DROPOFF_WRITE_MASK =
    ~(((1 << MAX_GAS_DROPOFF_SIZE) - 1) << MAX_GAS_DROPOFF_OFFSET);

  uint256 private constant GAS_DROPOFF_MARGIN_SIZE = PercentageLib.BYTE_SIZE * 8;
  uint256 private constant GAS_DROPOFF_MARGIN_OFFSET =
    MAX_GAS_DROPOFF_OFFSET + MAX_GAS_DROPOFF_SIZE;
  uint256 private constant GAS_DROPOFF_MARGIN_WRITE_MASK =
    ~(((1 << GAS_DROPOFF_MARGIN_SIZE) - 1) << GAS_DROPOFF_MARGIN_OFFSET);

  uint256 private constant GAS_TOKEN_PRICE_SIZE = 8 * 8;
  uint256 private constant GAS_TOKEN_PRICE_OFFSET =
    GAS_DROPOFF_MARGIN_OFFSET + GAS_DROPOFF_MARGIN_SIZE;
  uint256 private constant GAS_TOKEN_PRICE_WRITE_MASK =
    ~(((1 << GAS_TOKEN_PRICE_SIZE) - 1) << GAS_TOKEN_PRICE_OFFSET);

  function checkedWrap(uint256 value) internal pure returns (FeeParams) { unchecked {
    FeeParams params = FeeParams.wrap(value);

    //check percentage fields (they are the only ones that have a constraint)
    PercentageLib.checkedWrap(Percentage.unwrap(gasPriceMargin(params)));
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
    return uint64(FeeParams.unwrap(params) >> GAS_TOKEN_PRICE_OFFSET);
  }}

  function gasTokenPrice(
    FeeParams params,
    uint64 gasTokenPrice_
  ) internal pure returns (FeeParams) { unchecked {
    return FeeParams.wrap(
      (FeeParams.unwrap(params) & GAS_TOKEN_PRICE_WRITE_MASK) |
      (uint256(gasTokenPrice_) << GAS_TOKEN_PRICE_OFFSET)
    );
  }}
}
using FeeParamsLib for FeeParams global;
