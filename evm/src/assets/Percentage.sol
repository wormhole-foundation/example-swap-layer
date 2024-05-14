// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

//Solidity order of precedence:
//https://docs.soliditylang.org/en/latest/cheatsheet.html#order-of-precedence-of-operators

//used to represent percentages with 4 digits of precision with a maximum of 1000 %
//
//Reminder: Be mindful that this is percentage format, not a floating point format, i.e. multiply
//  and divide by 100 as necessary.
//Using the percentage format seems more intuitive for representation while more of a hassle
//  when multiplying/compounding. The opposite seems true for floating point format.
type Percentage is uint16;
library PercentageLib {
  uint internal constant BYTE_SIZE = 2;

  //percentages use a 14 bit mantissa / 2 bit exponent split custom format:
  // 2^14 = 16384, i.e. we get 4 full digits of precision and a can also represent 1000 %
  // 2 bits of the exponent are used to shift our decimal point *downwards*(!) via:
  //  value = mantissa / 10^(1 + exponent)
  // thus giving us a range of 0.abcd % to abc.d % (or 1000.00 %)
  //e.g. with (mantissa, exponent):
  //    0.1 % =     (1, 0) = 0b00000001100100_00 (or (10000, 1) or (100000, 2))
  //     10 % =   (100, 0) = 0b00000001100100_00 (or (10000, 1) or (100000, 2))
  //  432.1 % =  (4321, 0) = 0b01000011100001_00
  // 0.4321 % =  (4321, 3) = 0b01000011100001_11
  // 1000.0 % = (10000, 0) = 0b10011100010000_00
  uint private constant EXPONENT_BITS = 2;
  uint private constant EXPONENT_BASE = 1;
  uint private constant EXPONENT_BITS_MASK = (1 << EXPONENT_BITS) - 1;
  uint private constant MAX_MANTISSA = 1e4; //= 1000 % (if exponent = 0)
  //we essentially use a uint128 like an array of 4 uint24s containing [1e6, 1e5, 1e4, 1e3] as a
  //  simple way to save some gas over using EVM exponentiation
  uint private constant BITS_PER_POWER = 3*8; //4 powers, 3 bytes per power of ten, 8 bits per byte
  uint private constant POWERS_OF_TEN =
    (1e6 << 3*BITS_PER_POWER) +
    (1e5 << 2*BITS_PER_POWER) +
    (1e4 << 1*BITS_PER_POWER) +
    (1e3 << 0*BITS_PER_POWER);
  uint private constant POWERS_OF_TEN_MASK = (1 << BITS_PER_POWER) - 1;

  error InvalidPercentage(uint16 percentage);
  error InvalidArguments(uint mantissa, uint fractionalDigits);

  //to(3141, 3) = 3.141 %
  function to(
    uint value,
    uint fractionalDigits
  ) internal pure returns (Percentage) { unchecked {
    if (value == 0)
      return Percentage.wrap(0);

    if (fractionalDigits > 4)
      revert InvalidArguments(value, fractionalDigits);

    if (fractionalDigits == 0) {
      value *= 10;
      fractionalDigits = 1;
    }

    if (value > MAX_MANTISSA)
      revert InvalidArguments(value, fractionalDigits);

    value = (value << EXPONENT_BITS) | (fractionalDigits - 1);

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

  //we can silently overflow if value > 2^256/MAX_MANTISSA - not worth wasting gas to check
  //  if you have values this large you should know what you're doing regardless and can just
  //  check that the result is greater than or equal to the input value to detect overflows
  function compoundUnchecked(
    Percentage percentage_,
    uint value
  ) internal pure returns (uint) { unchecked {
    uint percentage = Percentage.unwrap(percentage_);
    //negative exponent = 0 -> denominator = 100, ..., negative exponent = 3 -> denominator = 1e5
    uint negativeExponent = percentage & EXPONENT_BITS_MASK;
    uint shift = negativeExponent * BITS_PER_POWER;
    uint denominator = POWERS_OF_TEN >> shift & POWERS_OF_TEN_MASK;
    uint numerator = value * (percentage >> EXPONENT_BITS);
    //the + here can overflow if value is within 2 orders of magnitude of 2^256
    return value + numerator/denominator;
  }}
}
using PercentageLib for Percentage global;