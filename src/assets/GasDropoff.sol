// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

type GasDropoff is uint32;
library GasDropoffLib {
  uint internal constant BYTE_SIZE = 4;
  
  error ExceedsMax(uint256 val);

  uint private constant GAS_DROPOFF_UNIT = 1e12 wei; //in microether (i.e. 1e-6 eth)

  function to(uint256 val) internal pure returns (GasDropoff) { unchecked {
    uint tmp = val / GAS_DROPOFF_UNIT;
    if (tmp > type(uint32).max)
      revert ExceedsMax(val);
    
    //skip unneccessary cleanup
    uint32 ret;
    assembly ("memory-safe") { ret := tmp }

    return GasDropoff.wrap(ret);
  }}

  function from(GasDropoff val) internal pure returns (uint256) { unchecked {
    return uint256(GasDropoff.unwrap(val)) * GAS_DROPOFF_UNIT;
  }
}}
