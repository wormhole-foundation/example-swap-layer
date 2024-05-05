// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { IERC20Permit } from "@openzeppelin/token/ERC20/extensions/IERC20Permit.sol";

import { toUniversalAddress } from "wormhole-sdk/Utils.sol";

import "swap-layer/assets/SwapLayerInitiate.sol";
import { encodeSwapMessage } from "swap-layer/assets/Message.sol";

import "./SwapBase.sol";

contract SwapLayerInitiateTest is SwapLayerSwapBase {
  using BytesParsing for bytes;
  using { toUniversalAddress } for address;

  function testInitiateDirectUsdc() public {
    uint amount = USER_AMOUNT * 1e6;
    _dealOverride(address(usdc), user, amount);
    vm.startPrank(user);
    usdc.approve(address(swapLayer), amount);
    bytes memory swapReturn = swapLayer.initiate(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        false,           //fast transfer
        RedeemMode.Direct,
        true,            //isExactIn
        IoToken.Usdc,    //input token
        uint128(amount), //input amount
        AcquireMode.Preapproved,
        IoToken.Usdc    //output token
      )
    );
    (uint amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertEq(amount, amountOut);
  }

  function testInitiatePermitUsdc() public {
    uint amount = USER_AMOUNT * 1e6;
    _dealOverride(address(usdc), user, amount);

    IERC20Permit usdcPermit = IERC20Permit(address(usdc));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(
      userSecret,
      keccak256(abi.encodePacked(
        hex"1901",
        usdcPermit.DOMAIN_SEPARATOR(),
        keccak256(abi.encode(
          keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
          user,
          address(swapLayer),
          amount,
          usdcPermit.nonces(user),
          _deadline()
        ))
      ))
    );
    vm.startPrank(user);
    usdc.approve(address(swapLayer), amount);
    bytes memory swapReturn = swapLayer.initiate(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        false,           //fast transfer
        RedeemMode.Direct,
        true,            //isExactIn
        IoToken.Usdc,    //input token
        uint128(amount), //input amount
        AcquireMode.Permit,
        amount,          //permit value
        _deadline(),     //permit deadline
        r, s, v,         //permit signature
        IoToken.Usdc     //output token
      )
    );
    (uint amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertEq(amount, amountOut);
  }

  function testInitiatePermit2TransferUsdc() public {
    uint amount = USER_AMOUNT * 1e6;
    _dealOverride(address(usdc), user, amount);

    (address permit2, ) = swapLayer.batchQueries(
      abi.encodePacked(QueryType.Immutable, ImmutableType.Permit2)
    ).asAddressUnchecked(0);

    uint256 nonce = 0;
    uint256 sigDeadline = _deadline();
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(
      userSecret,
      //see here: https://github.com/Uniswap/permit2/blob/cc56ad0f3439c502c246fc5cfcc3db92bb8b7219/src/SignatureTransfer.sol#L28
      keccak256(abi.encodePacked(
        hex"1901",
        IERC20Permit(permit2).DOMAIN_SEPARATOR(),
        keccak256(abi.encode(
          keccak256("PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"),
          keccak256(abi.encode(
            keccak256("TokenPermissions(address token,uint256 amount)"),
            ISignatureTransfer.TokenPermissions(address(usdc), amount)
          )),
          swapLayer,
          nonce,
          sigDeadline
        ))
      ))
    );

    vm.startPrank(user);
    usdc.approve(permit2, amount);
    bytes memory swapReturn = swapLayer.initiate(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        false,           //fast transfer
        RedeemMode.Direct,
        true,            //isExactIn
        IoToken.Usdc,    //input token
        uint128(amount), //input amount
        AcquireMode.Permit2Transfer,
        amount,
        nonce,
        sigDeadline,
        r, s, v,         //permit signature
        IoToken.Usdc     //output token
      )
    );
    (uint amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertEq(amount, amountOut);
  }

  function testInitiatePermit2PermitUsdc() public {
    uint amount = USER_AMOUNT * 1e6;
    _dealOverride(address(usdc), user, amount);

    (address permit2, ) = swapLayer.batchQueries(
      abi.encodePacked(QueryType.Immutable, ImmutableType.Permit2)
    ).asAddressUnchecked(0);

    uint48 expiration = uint48(_deadline());
    uint48 nonce = 0;
    uint256 sigDeadline = _deadline();
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(
      userSecret,
      //see here: https://github.com/Uniswap/permit2/blob/cc56ad0f3439c502c246fc5cfcc3db92bb8b7219/src/SignatureTransfer.sol#L28
      keccak256(abi.encodePacked(
        hex"1901",
        IERC20Permit(permit2).DOMAIN_SEPARATOR(),
        keccak256(abi.encode(
          keccak256("PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"),
          keccak256(abi.encode(
            keccak256("PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"),
            IAllowanceTransfer.PermitDetails(address(usdc), uint160(amount), expiration, nonce)
          )),
          swapLayer,
          sigDeadline
        ))
      ))
    );

    vm.startPrank(user);
    usdc.approve(permit2, amount);
    bytes memory swapReturn = swapLayer.initiate(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        false,           //fast transfer
        RedeemMode.Direct,
        true,            //isExactIn
        IoToken.Usdc,    //input token
        uint128(amount), //input amount
        AcquireMode.Permit2Permit,
        uint160(amount),
        expiration,
        nonce,
        sigDeadline,
        r, s, v,         //permit signature
        IoToken.Usdc     //output token
      )
    );
    (uint amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertEq(amount, amountOut);
  }

  function testInitiateUniswapEthSwap() public {
    hoax(user);
    bytes memory swapReturn = swapLayer.initiate{value: USER_AMOUNT * 1e18}(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        TransferMode.LiquidityLayer,
        RedeemMode.Direct,
        true,         //isExactIn
        IoToken.Gas,  //input token
        uint32(_deadline()), //deadline
        uint128(0),   //minOutputAmount
        uint8(SWAP_TYPE_UNISWAPV3),
        UNISWAP_FEE,
        uint8(1),     //pathLength
        address(mockToken),
        UNISWAP_FEE,
        IoToken.Usdc //output token
      )
    );
    (uint256 amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertTrue(amountOut > 0);
  }

  function testInitiateTraderJoeEthSwap() public {
    hoax(user);
    bytes memory swapReturn = swapLayer.initiate{value: USER_AMOUNT * 1e18}(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        TransferMode.LiquidityLayer,
        RedeemMode.Direct,
        true,         //isExactIn
        IoToken.Gas,  //input token
        uint32(_deadline()), //deadline
        uint128(0),   //minOutputAmount
        uint8(SWAP_TYPE_TRADERJOE),
        TRADERJOE_VERSION,
        TRADERJOE_BIN_STEP,
        uint8(1),     //pathLength
        address(mockToken),
        TRADERJOE_VERSION,
        TRADERJOE_BIN_STEP,
        IoToken.Usdc //output token
      )
    );
    (uint256 amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertTrue(amountOut > 0);
  }

  function testInitiateUniswapEthSwapRelayed() public {
    hoax(user);
    bytes memory swapReturn = swapLayer.initiate{value: USER_AMOUNT * 1e18}(
      FOREIGN_CHAIN_ID,
      user.toUniversalAddress(),
      abi.encodePacked(
        TransferMode.LiquidityLayer,
        RedeemMode.Relay,
        uint32(0),    //gas dropoff
        uint48(1e9),  //max relayer fee
        true,         //isExactIn
        IoToken.Gas,  //input token
        uint32(_deadline()), //deadline
        uint128(0),   //minOutputAmount
        uint8(SWAP_TYPE_UNISWAPV3),
        UNISWAP_FEE,
        uint8(1),     //pathLength
        address(mockToken),
        UNISWAP_FEE,
        IoToken.Usdc //output token
      )
    );
    (uint256 amountOut, ) = swapReturn.asUint256Unchecked(0);
    assertTrue(amountOut > 0);
  }
}
