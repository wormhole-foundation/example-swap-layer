// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import { Percentage, PercentageLib } from "swap-layer/assets/Percentage.sol";
import { nextRn, fuzzPercentage } from "./SLTBase.sol";

contract TypeLibsTest is Test {
  function testPercentageFixed() public pure {
    Percentage pi = PercentageLib.to(3141, 3);
    assertEq(pi.compoundUnchecked(1e0), 1);
    assertEq(pi.compoundUnchecked(1e1), 10);
    assertEq(pi.compoundUnchecked(1e2), 103);
    assertEq(pi.compoundUnchecked(1e3), 1031);
    assertEq(pi.compoundUnchecked(1e4), 10314);
    assertEq(pi.compoundUnchecked(1e5), 103141);

    assertEq(PercentageLib.to(3141, 4).compoundUnchecked(1e6), 1003141);
  }

  function testPercentageDigit() public pure {
    for (uint digit = 0; digit < 10; ++digit) {
      assertEq(PercentageLib.to(digit * 100, 0).compoundUnchecked(1e0), 1e0 + digit);
      assertEq(PercentageLib.to(digit *  10, 0).compoundUnchecked(1e1), 1e1 + digit);
      assertEq(PercentageLib.to(digit      , 0).compoundUnchecked(1e2), 1e2 + digit);
      assertEq(PercentageLib.to(digit      , 1).compoundUnchecked(1e3), 1e3 + digit);
      assertEq(PercentageLib.to(digit      , 2).compoundUnchecked(1e4), 1e4 + digit);
      assertEq(PercentageLib.to(digit      , 3).compoundUnchecked(1e5), 1e5 + digit);
      assertEq(PercentageLib.to(digit      , 4).compoundUnchecked(1e6), 1e6 + digit);
    }
  }

  function testFuzzPercentage(uint value, uint rngSeed_) public pure {
    uint[] memory rngSeed = new uint[](1);
    rngSeed[0] = rngSeed_;
    vm.assume(value < type(uint256).max/1e4);
    Percentage percentage = fuzzPercentage(rngSeed);
    uint unwrapped   = Percentage.unwrap(percentage);
    uint mantissa    = unwrapped >> 2;
    uint fractDigits = (unwrapped & 3) + 1;
    uint denominator = 10**(fractDigits + 2); //+2 to adjust for percentage to floating point conv
    assertEq(percentage.compoundUnchecked(value), value + value * mantissa / denominator);
  }
}
