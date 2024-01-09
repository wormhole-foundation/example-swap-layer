// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

type GasPrice is uint32;
library GasPriceLib {
  uint internal constant BYTE_SIZE = 4;

  error ExceedsMax(uint256 val);

  uint private constant GAS_PRICE_UNIT = 1e6 wei;

  function to(uint256 val) internal pure returns (GasPrice) { unchecked {
    uint tmp = val / GAS_PRICE_UNIT;
    if (tmp > type(uint32).max)
      revert ExceedsMax(val);
    
    //skip unneccessary cleanup
    uint32 ret;
    assembly ("memory-safe") { ret := tmp }

    return GasPrice.wrap(ret);
  }}

  function from(GasPrice val) internal pure returns (uint256) { unchecked {
    return uint256(GasPrice.unwrap(val)) * GAS_PRICE_UNIT;
  }
}}
