// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

//Solidity order of precedence:
//https://docs.soliditylang.org/en/latest/cheatsheet.html#order-of-precedence-of-operators

type Percentage is uint16;
library PercentageLib {
  uint internal constant BYTE_SIZE = 2;

  //percentages use a 14 bit mantissa / 2 bit exponent split custom format:
  // 2^14 = 16384, i.e. we get 4 digits of precision and can also represent 100 %
  // 2 bits of the exponent are used to shift our decimal point *downwards*(!) via:
  //  value = mantissa / 10^(2 + exponent)
  // thus giving us a range of 0.0abcd % to ab.cd % (or 100.00 %)
  //e.g. with (mantissa, exponent):
  //       1 % =   (100, 0) = 0b00000001100100_00 (or (1000, 1) or (10000, 2))
  //   43.21 % =  (4321, 0) = 0b01000011100001_00
  // 0.04321 % =  (4321, 3) = 0b01000011100001_11
  //  100.00 % = (10000, 0) = 0b10011100010000_00
  uint private constant EXPONENT_BITS = 2;
  uint private constant EXPONENT_BITS_MASK = (1 << EXPONENT_BITS) - 1;
  uint private constant MAX_MANTISSA = 1e4; //= 100 % (if exponent = 0)
  //we essentially use a uint256 like an array of 4 uint64s containing [1e5, 1e4, 1e3, 1e2] as a
  //  simple way to save some gas over using EVM exponentiation
  uint private constant BITS_PER_POWER = 8*8; //4 powers, 8 bytes per power of ten, 8 bits per byte
  uint private constant POWERS_OF_TEN =
    (1e5 << 3*BITS_PER_POWER) +
    (1e4 << 2*BITS_PER_POWER) +
    (1e3 << 1*BITS_PER_POWER) +
    (1e2 << 0*BITS_PER_POWER);
  uint private constant POWERS_OF_TEN_MASK = (1 << BITS_PER_POWER) - 1;

  error InvalidPercentage(uint16 percentage);
  error InvalidArguments(uint mantissa, uint fractionalDigits);

  function to(uint value, uint fractionalDigits) internal pure returns (Percentage) { unchecked {
    if (value == 0)
      return Percentage.wrap(0);

    if (fractionalDigits > 5)
      revert InvalidArguments(value, fractionalDigits);

    if (fractionalDigits < 2) {
      value *= fractionalDigits == 0 ? 100 : 10;
      fractionalDigits = 2;
    }

    if (value > MAX_MANTISSA)
      revert InvalidArguments(value, fractionalDigits);

    value = (value << EXPONENT_BITS) | (fractionalDigits - 2);

    uint16 ret;
    //skip unneccessary cleanup
    assembly ("memory-safe") { ret := value }

    return Percentage.wrap(ret);
  }}

  function checkedWrap(uint16 percentage) internal pure returns (Percentage) { unchecked {
    if ((percentage >> EXPONENT_BITS) > MAX_MANTISSA)
      revert InvalidPercentage(percentage);

    return Percentage.wrap(percentage);
  }}

  function compound(
    Percentage percentage_,
    uint value
  ) internal pure returns (uint) { unchecked {
    uint percentage = Percentage.unwrap(percentage_);
    //negative exponent = 0 -> denominator = 100, ..., negative exponent = 3 -> denominator = 1e5
    uint negativeExponent = percentage & EXPONENT_BITS_MASK;
    uint shift = negativeExponent * BITS_PER_POWER;
    uint denominator = POWERS_OF_TEN >> shift & POWERS_OF_TEN_MASK;
    uint numerator = value * (percentage >> EXPONENT_BITS);
    return value + numerator/denominator;
  }}
}
using PercentageLib for Percentage global;