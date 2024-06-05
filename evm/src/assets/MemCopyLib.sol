// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.26;

library MemCopyLib {
  uint256 private constant wordSize = 32;
  uint256 private constant wordSizeMinusOne = 31;
  uint256 private constant bitsPerByte = 8;

  error OutOfBounds(uint256 length, uint256 offset, uint256 count);

  function checkBound(bytes memory byt, uint offset, uint count) private pure {
    if (byt.length < offset + count)
      revert OutOfBounds(byt.length, offset, count);
  }

  //file structure:
  // - unchecked functions
  // - checked functions

  //------------------------------------------------------------------------------------------------
  //--------------------- Unchecked Function Versions (also use unchecked math) --------------------
  //------------------------------------------------------------------------------------------------

  function memcpyUnchecked(
    bytes memory destination,
    uint dstOffset,
    bytes memory source,
    uint srcOffset,
    uint count
  ) internal view {
    assembly ("memory-safe") {
      //account for lengths at the start of the byte arrays
      let dst := add(destination, add(dstOffset, wordSize))
      let src := add(source, add(srcOffset, wordSize))
      switch chainid()
      case 1 {
        //on Ethereum mainnet, use the optimized mcopy
        mcopy(dst, src, count)
      }
      default {
        //copy all full words
        for {} gt(count, wordSizeMinusOne) { //use gt rather than gte comparison to save gas
          src := add(src, wordSize) 
          dst := add(dst, wordSize)
          count := sub(count, wordSize)
        } {
          mstore(dst, mload(src))
        }
        //copy the remaining bytes, if any
        if count {
          let dstCount := sub(wordSize, count)
          //load the last count bytes into the right most bytes of the word, then shift
          //  left to put them in the upper most bytes, filling the rest with zeros
          let srcBytes := shl(mul(dstCount, bitsPerByte), mload(sub(src, dstCount)))
          //then load the remaining bytes from the destination that ought to remain unchanged
          //  and shif them to the right to put them in the lower most bytes
          let dstBytes := shr(mul(count, bitsPerByte), mload(add(dst, count)))
          //finally, merge the two and store them in the destination
          mstore(dst, add(srcBytes, dstBytes))
        }
      }
    }
  }

  function memcpyUnchecked(
    bytes memory destination,
    uint dstOffset,
    bytes memory source,
    uint srcOffset
  ) internal view { unchecked {
    memcpyUnchecked(destination, dstOffset, source, srcOffset, source.length - srcOffset);
  }}

  function memcpyUnchecked(
    bytes memory destination,
    uint dstOffset,
    bytes memory source
  ) internal view {
    memcpyUnchecked(destination, dstOffset, source, 0, source.length);
  }

  //"generic" mstore version that can be chosen over specific uint<n> version for less code at
  //  the expense of more gas when using mstore for many different types
  function mstoreUnchecked(
    bytes memory destination,
    uint dstOffset,
    uint source,
    uint count
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstCount := sub(wordSize, count)
      let srcBytes := shl(mul(dstCount, bitsPerByte), source)
      let dstBytes := shr(mul(count, bitsPerByte), mload(add(dst, count)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore32Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      mstore(dst, source)
    }
  }

  function mstore32Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes32 source
  ) internal pure {
    mstore32Unchecked(destination, dstOffset, uint256(source));
  }

  function mstore1Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      mstore8(dst, source)
    }
  }

  function mstore1Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes1 source
  ) internal pure {
    mstore8Unchecked(destination, dstOffset, uint8(source));
  }

  function mstore2Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      mstore8(dst, source)
      mstore8(add(dst, 1), shr(8, source))
    }
  }

  function mstore2Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes2 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      mstore8(dst, shr(248, source))
      mstore8(add(dst, 1), shr(240, source))
    }
  }

/* -------------------------------------------------------------------------------------------------
Remaining mstoreUnchecked functions were auto-generated via the following js/node code:

for (let bytes = 3; bytes < 32; ++bytes)
  console.log(
`function mstore${bytes}Unchecked(
  bytes memory destination,
  uint dstOffset,
  uint source
) internal pure {
  assembly ("memory-safe") {
    let dst := add(destination, add(dstOffset, wordSize))
    let srcBytes := shl(${(32 - bytes) * 8}, source)
    let dstBytes := shr(${bytes * 8}, mload(add(dst, ${bytes})))
    mstore(dst, add(srcBytes, dstBytes))
  }
}

function mstore${bytes}Unchecked(
  bytes memory destination,
  uint dstOffset,
  bytes${bytes} source
) internal pure {
  assembly ("memory-safe") {
    let dst := add(destination, add(dstOffset, wordSize))
    let dstBytes := shr(${bytes * 8}, mload(add(dst, ${bytes})))
    mstore(dst, add(source, dstBytes))
  }
}
`
  );
------------------------------------------------------------------------------------------------- */

  function mstore3Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(232, source)
      let dstBytes := shr(24, mload(add(dst, 3)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore3Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes3 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(24, mload(add(dst, 3)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore4Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(224, source)
      let dstBytes := shr(32, mload(add(dst, 4)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore4Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes4 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(32, mload(add(dst, 4)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore5Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(216, source)
      let dstBytes := shr(40, mload(add(dst, 5)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore5Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes5 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(40, mload(add(dst, 5)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore6Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(208, source)
      let dstBytes := shr(48, mload(add(dst, 6)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore6Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes6 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(48, mload(add(dst, 6)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore7Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(200, source)
      let dstBytes := shr(56, mload(add(dst, 7)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore7Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes7 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(56, mload(add(dst, 7)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore8Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(192, source)
      let dstBytes := shr(64, mload(add(dst, 8)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore8Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes8 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(64, mload(add(dst, 8)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore9Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(184, source)
      let dstBytes := shr(72, mload(add(dst, 9)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore9Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes9 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(72, mload(add(dst, 9)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore10Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(176, source)
      let dstBytes := shr(80, mload(add(dst, 10)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore10Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes10 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(80, mload(add(dst, 10)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore11Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(168, source)
      let dstBytes := shr(88, mload(add(dst, 11)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore11Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes11 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(88, mload(add(dst, 11)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore12Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(160, source)
      let dstBytes := shr(96, mload(add(dst, 12)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore12Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes12 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(96, mload(add(dst, 12)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore13Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(152, source)
      let dstBytes := shr(104, mload(add(dst, 13)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore13Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes13 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(104, mload(add(dst, 13)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore14Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(144, source)
      let dstBytes := shr(112, mload(add(dst, 14)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore14Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes14 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(112, mload(add(dst, 14)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore15Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(136, source)
      let dstBytes := shr(120, mload(add(dst, 15)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore15Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes15 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(120, mload(add(dst, 15)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore16Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(128, source)
      let dstBytes := shr(128, mload(add(dst, 16)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore16Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes16 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(128, mload(add(dst, 16)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore17Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(120, source)
      let dstBytes := shr(136, mload(add(dst, 17)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore17Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes17 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(136, mload(add(dst, 17)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore18Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(112, source)
      let dstBytes := shr(144, mload(add(dst, 18)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore18Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes18 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(144, mload(add(dst, 18)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore19Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(104, source)
      let dstBytes := shr(152, mload(add(dst, 19)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore19Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes19 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(152, mload(add(dst, 19)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore20Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(96, source)
      let dstBytes := shr(160, mload(add(dst, 20)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore20Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes20 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(160, mload(add(dst, 20)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore21Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(88, source)
      let dstBytes := shr(168, mload(add(dst, 21)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore21Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes21 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(168, mload(add(dst, 21)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore22Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(80, source)
      let dstBytes := shr(176, mload(add(dst, 22)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore22Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes22 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(176, mload(add(dst, 22)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore23Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(72, source)
      let dstBytes := shr(184, mload(add(dst, 23)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore23Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes23 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(184, mload(add(dst, 23)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore24Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(64, source)
      let dstBytes := shr(192, mload(add(dst, 24)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore24Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes24 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(192, mload(add(dst, 24)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore25Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(56, source)
      let dstBytes := shr(200, mload(add(dst, 25)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore25Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes25 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(200, mload(add(dst, 25)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore26Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(48, source)
      let dstBytes := shr(208, mload(add(dst, 26)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore26Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes26 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(208, mload(add(dst, 26)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore27Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(40, source)
      let dstBytes := shr(216, mload(add(dst, 27)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore27Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes27 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(216, mload(add(dst, 27)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore28Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(32, source)
      let dstBytes := shr(224, mload(add(dst, 28)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore28Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes28 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(224, mload(add(dst, 28)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore29Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(24, source)
      let dstBytes := shr(232, mload(add(dst, 29)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore29Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes29 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(232, mload(add(dst, 29)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore30Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(16, source)
      let dstBytes := shr(240, mload(add(dst, 30)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore30Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes30 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(240, mload(add(dst, 30)))
      mstore(dst, add(source, dstBytes))
    }
  }

  function mstore31Unchecked(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let srcBytes := shl(8, source)
      let dstBytes := shr(248, mload(add(dst, 31)))
      mstore(dst, add(srcBytes, dstBytes))
    }
  }

  function mstore31Unchecked(
    bytes memory destination,
    uint dstOffset,
    bytes31 source
  ) internal pure {
    assembly ("memory-safe") {
      let dst := add(destination, add(dstOffset, wordSize))
      let dstBytes := shr(248, mload(add(dst, 31)))
      mstore(dst, add(source, dstBytes))
    }
  }

  //------------------------------------------------------------------------------------------------
  //--------------------- Unchecked Function Versions (also use unchecked math) --------------------
  //------------------------------------------------------------------------------------------------

  function memcpy(
    bytes memory destination,
    uint dstOffset,
    bytes memory source,
    uint srcOffset,
    uint count
  ) internal view {
    checkBound(destination, dstOffset, count);
    checkBound(source, srcOffset, count);
    memcpyUnchecked(destination, dstOffset, source, srcOffset, count);
  }

  function memcpy(
    bytes memory destination,
    uint dstOffset,
    bytes memory source,
    uint srcOffset
  ) internal view { unchecked {
    checkBound(source, srcOffset, 0); //will revert it source.length < srcOffset
    uint count = source.length - srcOffset;
    checkBound(destination, dstOffset, count);
    memcpyUnchecked(destination, dstOffset, source, srcOffset, count);
  }}

  function memcpy(
    bytes memory destination,
    uint dstOffset,
    bytes memory source
  ) internal view {
    checkBound(destination, dstOffset, source.length);
    memcpyUnchecked(destination, dstOffset, source);
  }

  function mstore(
    bytes memory destination,
    uint dstOffset,
    uint source,
    uint count
  ) internal pure {
    checkBound(destination, dstOffset, count);
    mstoreUnchecked(destination, dstOffset, source, count);
  }

/* -------------------------------------------------------------------------------------------------
Remaining checked functions were auto-generated via the following js/node code:

for (let bytes = 1; bytes <= 32; ++bytes)
  console.log(
`function mstore${bytes}(
  bytes memory destination,
  uint dstOffset,
  uint source
) internal pure {
  checkBound(destination, dstOffset, ${bytes});
  mstore${bytes}Unchecked(destination, dstOffset, source);
}

function mstore${bytes}(
  bytes memory destination,
  uint dstOffset,
  bytes${bytes} source
) internal pure {
  checkBound(destination, dstOffset, ${bytes});
  mstore${bytes}Unchecked(destination, dstOffset, source);
}
`
  );
}
------------------------------------------------------------------------------------------------- */

  function mstore1(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 1);
    mstore1Unchecked(destination, dstOffset, source);
  }

  function mstore1(
    bytes memory destination,
    uint dstOffset,
    bytes1 source
  ) internal pure {
    checkBound(destination, dstOffset, 1);
    mstore1Unchecked(destination, dstOffset, source);
  }

  function mstore2(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 2);
    mstore2Unchecked(destination, dstOffset, source);
  }

  function mstore2(
    bytes memory destination,
    uint dstOffset,
    bytes2 source
  ) internal pure {
    checkBound(destination, dstOffset, 2);
    mstore2Unchecked(destination, dstOffset, source);
  }

  function mstore3(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 3);
    mstore3Unchecked(destination, dstOffset, source);
  }

  function mstore3(
    bytes memory destination,
    uint dstOffset,
    bytes3 source
  ) internal pure {
    checkBound(destination, dstOffset, 3);
    mstore3Unchecked(destination, dstOffset, source);
  }

  function mstore4(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 4);
    mstore4Unchecked(destination, dstOffset, source);
  }

  function mstore4(
    bytes memory destination,
    uint dstOffset,
    bytes4 source
  ) internal pure {
    checkBound(destination, dstOffset, 4);
    mstore4Unchecked(destination, dstOffset, source);
  }

  function mstore5(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 5);
    mstore5Unchecked(destination, dstOffset, source);
  }

  function mstore5(
    bytes memory destination,
    uint dstOffset,
    bytes5 source
  ) internal pure {
    checkBound(destination, dstOffset, 5);
    mstore5Unchecked(destination, dstOffset, source);
  }

  function mstore6(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 6);
    mstore6Unchecked(destination, dstOffset, source);
  }

  function mstore6(
    bytes memory destination,
    uint dstOffset,
    bytes6 source
  ) internal pure {
    checkBound(destination, dstOffset, 6);
    mstore6Unchecked(destination, dstOffset, source);
  }

  function mstore7(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 7);
    mstore7Unchecked(destination, dstOffset, source);
  }

  function mstore7(
    bytes memory destination,
    uint dstOffset,
    bytes7 source
  ) internal pure {
    checkBound(destination, dstOffset, 7);
    mstore7Unchecked(destination, dstOffset, source);
  }

  function mstore8(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 8);
    mstore8Unchecked(destination, dstOffset, source);
  }

  function mstore8(
    bytes memory destination,
    uint dstOffset,
    bytes8 source
  ) internal pure {
    checkBound(destination, dstOffset, 8);
    mstore8Unchecked(destination, dstOffset, source);
  }

  function mstore9(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 9);
    mstore9Unchecked(destination, dstOffset, source);
  }

  function mstore9(
    bytes memory destination,
    uint dstOffset,
    bytes9 source
  ) internal pure {
    checkBound(destination, dstOffset, 9);
    mstore9Unchecked(destination, dstOffset, source);
  }

  function mstore10(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 10);
    mstore10Unchecked(destination, dstOffset, source);
  }

  function mstore10(
    bytes memory destination,
    uint dstOffset,
    bytes10 source
  ) internal pure {
    checkBound(destination, dstOffset, 10);
    mstore10Unchecked(destination, dstOffset, source);
  }

  function mstore11(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 11);
    mstore11Unchecked(destination, dstOffset, source);
  }

  function mstore11(
    bytes memory destination,
    uint dstOffset,
    bytes11 source
  ) internal pure {
    checkBound(destination, dstOffset, 11);
    mstore11Unchecked(destination, dstOffset, source);
  }

  function mstore12(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 12);
    mstore12Unchecked(destination, dstOffset, source);
  }

  function mstore12(
    bytes memory destination,
    uint dstOffset,
    bytes12 source
  ) internal pure {
    checkBound(destination, dstOffset, 12);
    mstore12Unchecked(destination, dstOffset, source);
  }

  function mstore13(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 13);
    mstore13Unchecked(destination, dstOffset, source);
  }

  function mstore13(
    bytes memory destination,
    uint dstOffset,
    bytes13 source
  ) internal pure {
    checkBound(destination, dstOffset, 13);
    mstore13Unchecked(destination, dstOffset, source);
  }

  function mstore14(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 14);
    mstore14Unchecked(destination, dstOffset, source);
  }

  function mstore14(
    bytes memory destination,
    uint dstOffset,
    bytes14 source
  ) internal pure {
    checkBound(destination, dstOffset, 14);
    mstore14Unchecked(destination, dstOffset, source);
  }

  function mstore15(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 15);
    mstore15Unchecked(destination, dstOffset, source);
  }

  function mstore15(
    bytes memory destination,
    uint dstOffset,
    bytes15 source
  ) internal pure {
    checkBound(destination, dstOffset, 15);
    mstore15Unchecked(destination, dstOffset, source);
  }

  function mstore16(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 16);
    mstore16Unchecked(destination, dstOffset, source);
  }

  function mstore16(
    bytes memory destination,
    uint dstOffset,
    bytes16 source
  ) internal pure {
    checkBound(destination, dstOffset, 16);
    mstore16Unchecked(destination, dstOffset, source);
  }

  function mstore17(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 17);
    mstore17Unchecked(destination, dstOffset, source);
  }

  function mstore17(
    bytes memory destination,
    uint dstOffset,
    bytes17 source
  ) internal pure {
    checkBound(destination, dstOffset, 17);
    mstore17Unchecked(destination, dstOffset, source);
  }

  function mstore18(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 18);
    mstore18Unchecked(destination, dstOffset, source);
  }

  function mstore18(
    bytes memory destination,
    uint dstOffset,
    bytes18 source
  ) internal pure {
    checkBound(destination, dstOffset, 18);
    mstore18Unchecked(destination, dstOffset, source);
  }

  function mstore19(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 19);
    mstore19Unchecked(destination, dstOffset, source);
  }

  function mstore19(
    bytes memory destination,
    uint dstOffset,
    bytes19 source
  ) internal pure {
    checkBound(destination, dstOffset, 19);
    mstore19Unchecked(destination, dstOffset, source);
  }

  function mstore20(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 20);
    mstore20Unchecked(destination, dstOffset, source);
  }

  function mstore20(
    bytes memory destination,
    uint dstOffset,
    bytes20 source
  ) internal pure {
    checkBound(destination, dstOffset, 20);
    mstore20Unchecked(destination, dstOffset, source);
  }

  function mstore21(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 21);
    mstore21Unchecked(destination, dstOffset, source);
  }

  function mstore21(
    bytes memory destination,
    uint dstOffset,
    bytes21 source
  ) internal pure {
    checkBound(destination, dstOffset, 21);
    mstore21Unchecked(destination, dstOffset, source);
  }

  function mstore22(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 22);
    mstore22Unchecked(destination, dstOffset, source);
  }

  function mstore22(
    bytes memory destination,
    uint dstOffset,
    bytes22 source
  ) internal pure {
    checkBound(destination, dstOffset, 22);
    mstore22Unchecked(destination, dstOffset, source);
  }

  function mstore23(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 23);
    mstore23Unchecked(destination, dstOffset, source);
  }

  function mstore23(
    bytes memory destination,
    uint dstOffset,
    bytes23 source
  ) internal pure {
    checkBound(destination, dstOffset, 23);
    mstore23Unchecked(destination, dstOffset, source);
  }

  function mstore24(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 24);
    mstore24Unchecked(destination, dstOffset, source);
  }

  function mstore24(
    bytes memory destination,
    uint dstOffset,
    bytes24 source
  ) internal pure {
    checkBound(destination, dstOffset, 24);
    mstore24Unchecked(destination, dstOffset, source);
  }

  function mstore25(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 25);
    mstore25Unchecked(destination, dstOffset, source);
  }

  function mstore25(
    bytes memory destination,
    uint dstOffset,
    bytes25 source
  ) internal pure {
    checkBound(destination, dstOffset, 25);
    mstore25Unchecked(destination, dstOffset, source);
  }

  function mstore26(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 26);
    mstore26Unchecked(destination, dstOffset, source);
  }

  function mstore26(
    bytes memory destination,
    uint dstOffset,
    bytes26 source
  ) internal pure {
    checkBound(destination, dstOffset, 26);
    mstore26Unchecked(destination, dstOffset, source);
  }

  function mstore27(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 27);
    mstore27Unchecked(destination, dstOffset, source);
  }

  function mstore27(
    bytes memory destination,
    uint dstOffset,
    bytes27 source
  ) internal pure {
    checkBound(destination, dstOffset, 27);
    mstore27Unchecked(destination, dstOffset, source);
  }

  function mstore28(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 28);
    mstore28Unchecked(destination, dstOffset, source);
  }

  function mstore28(
    bytes memory destination,
    uint dstOffset,
    bytes28 source
  ) internal pure {
    checkBound(destination, dstOffset, 28);
    mstore28Unchecked(destination, dstOffset, source);
  }

  function mstore29(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 29);
    mstore29Unchecked(destination, dstOffset, source);
  }

  function mstore29(
    bytes memory destination,
    uint dstOffset,
    bytes29 source
  ) internal pure {
    checkBound(destination, dstOffset, 29);
    mstore29Unchecked(destination, dstOffset, source);
  }

  function mstore30(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 30);
    mstore30Unchecked(destination, dstOffset, source);
  }

  function mstore30(
    bytes memory destination,
    uint dstOffset,
    bytes30 source
  ) internal pure {
    checkBound(destination, dstOffset, 30);
    mstore30Unchecked(destination, dstOffset, source);
  }

  function mstore31(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 31);
    mstore31Unchecked(destination, dstOffset, source);
  }

  function mstore31(
    bytes memory destination,
    uint dstOffset,
    bytes31 source
  ) internal pure {
    checkBound(destination, dstOffset, 31);
    mstore31Unchecked(destination, dstOffset, source);
  }

  function mstore32(
    bytes memory destination,
    uint dstOffset,
    uint source
  ) internal pure {
    checkBound(destination, dstOffset, 32);
    mstore32Unchecked(destination, dstOffset, source);
  }

  function mstore32(
    bytes memory destination,
    uint dstOffset,
    bytes32 source
  ) internal pure {
    checkBound(destination, dstOffset, 32);
    mstore32Unchecked(destination, dstOffset, source);
  }
}
