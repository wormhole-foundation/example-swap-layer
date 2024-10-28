---
sponsor: "Audit 402"
slug: "2024-07-audit-402"
date: "2024-07-DD"  # the date this report is published to the C4 website
title: "Audit 402 Invitational"
findings: "https://github.com/code-423n4/2024-07-audit-402-findings/issues"
contest: 402
---

# Overview

## About C4

Code4rena (C4) is an open organization consisting of security researchers, auditors, developers, and individuals with domain expertise in smart contracts.

A C4 audit is an event in which community participants, referred to as Wardens, review, audit, or analyze smart contract logic in exchange for a bounty provided by sponsoring projects.

During the audit outlined in this document, C4 conducted an analysis of the Audit 402 smart contract system written in Solidity. The audit took place between July 1 — July 15, 2024.

## Wardens

In Code4rena's Invitational audits, the competition is limited to a small group of wardens; for this audit, 5 wardens participated:

  1. [SpicyMeatball](https://code4rena.com/@SpicyMeatball)
  2. [ladboy233](https://code4rena.com/@ladboy233)
  3. [Ch\_301](https://code4rena.com/@Ch_301)
  4. [monrel](https://code4rena.com/@monrel)
  5. [t0x1c](https://code4rena.com/@t0x1c)

This audit was judged by [0xsomeone](https://code4rena.com/@0xsomeone).

Final report assembled by [thebrittfactor](https://twitter.com/brittfactorC4).

# Summary

The C4 analysis yielded an aggregated total of 2 unique vulnerabilities, both receiving a risk rating in the category of MEDIUM severity.

Additionally, C4 analysis included 4 reports detailing issues with a risk rating of LOW severity or non-critical.

All of the issues presented here are linked back to their original finding.

# Scope

The code under review can be found within the [C4 Audit 402 repository](https://github.com/code-423n4/2024-07-audit-402), and is composed of 21 smart contracts written in the Solidity programming language and includes 2544 lines of Solidity code.

# Severity Criteria

C4 assesses the severity of disclosed vulnerabilities based on three primary risk categories: high, medium, and low/non-critical.

High-level considerations for vulnerabilities span the following key areas when conducting assessments:

- Malicious Input Handling
- Escalation of privileges
- Arithmetic
- Gas use

For more information regarding the severity criteria referenced throughout the submission review process, please refer to the documentation provided on [the C4 website](https://code4rena.com), specifically our section on [Severity Categorization](https://docs.code4rena.com/awarding/judging-criteria/severity-categorization).

# Medium Risk Findings (2)
## [[M-01] Incorrect path encoding in SwapLayerIntegrationBase.sol](https://github.com/code-423n4/2024-07-audit-402-findings/issues/10)
*Submitted by [SpicyMeatball](https://github.com/code-423n4/2024-07-audit-402-findings/issues/10)*

The `SwapLayerIntegrationBase.sol` contract will not work if user specifies full path for his swaps.

### Proof of Concept

While using `SwapLayerIntegrationBase.sol` users can specify either the stripped path for their swaps (`pool->token->pool`) or the full path (`tokenIn->pool->token->pool->usdc`). The `_encodeSwapParams` function makes sure that the user provided path is encoded in a way the `SwapLayer` expects:

- 4 bytes - deadline;
- 16 bytes - output amount.
- 1 byte - swap type.
- 3 bytes - first pool.
- 1 byte - partial path length.
- `N * (20 + 3)` bytes - partial path, where `N - number of swaps` in the path.

```solidity
  function _encodeSwapParams(
    EvmSwapParams memory params,
    bool checkTokens,
    address fromToken,
    address toToken
  ) private pure returns (bytes memory) { unchecked {
>>  uint startOffset = _swapPathStartOffset(params.path, checkTokens, fromToken, toToken);
    (uint24 firstPoolId, uint offset) = params.path.asUint24Unchecked(startOffset);
>>  uint pathLength = (params.path.length - startOffset) / SHARED_PATH_ELEMENT_SIZE;
    _checkMax(pathLength, type(uint8).max);
>>  (bytes memory finalPath, ) =
      params.path.sliceUnchecked(offset, pathLength * SHARED_PATH_ELEMENT_SIZE);

    return abi.encodePacked(
      _encodeSharedSwapParams(params.deadline, params.outputAmount),
      _toSwapType(params.swapType),
      firstPoolId,
      uint8(pathLength),
      finalPath
    );
  }}
```

If a user provides a full path `_swapPathStartOffset` will return 20 bytes offset to skip the input token address. However, the encoded `finalPath` will be incorrect because the output token address is not removed. For example, if we have the path `weth(20 bytes)->pool(3 bytes)->usdc(20 bytes)`, `startOffset` is 20, `pathLength = 43 - 20 / 23 = 1`; which means the final partial path will be incorrectly sliced and will look like `usdc + 0x000000` instead of zero bytes.

Check this coded POC for `test/Initiate.t.sol`, run `testPreapprovalUniswap`:

```solidity
  function _testPreapproval(EvmSwapType swapType) internal {
    uint amount = USER_AMOUNT * 10 ** MOCK_TOKEN_DECIMALS;
    _dealOverride(address(mockToken), user, amount);
    vm.startPrank(user);
    mockToken.approve(address(swapLayer), amount);

    uint deadline = 0;
    uint minOut = 1e6;
    bytes memory path = abi.encodePacked(
      address(mockToken),
      _evmSwapTypeToPoolId(swapType == EvmSwapType.UniswapV3
        ? SWAP_TYPE_UNISWAPV3
        : SWAP_TYPE_TRADERJOE
      ),
      address(usdc)
    );

    InitiateToken memory params = InitiateToken({
      targetParams: TargetParams(FOREIGN_CHAIN_ID, recipient.toUniversalAddress()),
      inputToken: address(mockToken),
      amount: amount,
      isExactIn: true,
      approveCheck: true,
      evmSwapParams: EvmSwapParams(deadline, minOut, swapType, path),
      outputParams: _swapLayerEncodeOutputParamsUsdc()
    });

    _swapLayerInitiate(params);
  }

  function testPreapprovalUniswap() public {
    _testPreapproval(EvmSwapType.UniswapV3);
  }
```

### Tools Used

Foundry

### Recommended Mitigation Steps

```diff
  function _encodeSwapParams(
    EvmSwapParams memory params,
    bool checkTokens,
    address fromToken,
    address toToken
  ) private pure returns (bytes memory) { unchecked {
    uint startOffset = _swapPathStartOffset(params.path, checkTokens, fromToken, toToken);
    (uint24 firstPoolId, uint offset) = params.path.asUint24Unchecked(startOffset);
-   uint pathLength = (params.path.length - startOffset) / SHARED_PATH_ELEMENT_SIZE;
+   uint pathLength = (params.path.length - startOffset - offset) / SHARED_PATH_ELEMENT_SIZE;
```

### Assessed type

en/de-code

**[djb15 (Audit 402) confirmed and commented](https://github.com/code-423n4/2024-07-audit-402-findings/issues/10#issuecomment-2234823479):**
 > Nice catch! Fixed [here](https://github.com/XLabs/swap-layer/commit/10b4e7668eb5d8165dacf3ecf93f29401d999d14#diff-33636350fe4b3cc3067b6d43a9bfe0cb09df9e1717e5c43ca7d6e1b01e9731e1L1276).

**[0xsomeone (judge) commented](https://github.com/code-423n4/2024-07-audit-402-findings/issues/10#issuecomment-2239045251):**
 > The Warden has outlined how the swap path encoding mechanism will improperly encode full execution paths due to mishandling the path length. 
> 
> I believe a medium risk severity rating is appropriate given that swaps can still occur albeit under a different encoding scheme. Kudos on this finding!

***

## [[M-02] Incorrect swap parameters if `isExactIn == false` in the UniswapV3R](https://github.com/code-423n4/2024-07-audit-402-findings/issues/7)
*Submitted by [SpicyMeatball](https://github.com/code-423n4/2024-07-audit-402-findings/issues/7)*

The `SwapLayerUniswapV3R.sol` contract calls the `exactOutput` function with incorrect parameters, causing the `initiate` transaction to always revert if `isExactIn == false`.

### Proof of Concept

When the user calls the `initiate` function in the `SwapLayer.sol` contract, he has the option to specify whether his swap will be `isExactIn == true` or `isExactIn == false`:

<https://github.com/code-423n4/2024-07-audit-402/blob/main/evm/src/assets/SwapLayerInitiate.sol#L118>

```solidity
  function _acquireUsdc(
    uint totalFee,
    ModesOffsetsSizes memory mos,
    bytes memory params
  ) private returns (uint64 usdcAmount, uint wormholeFee) { unchecked {
      ---SNIP---

      else if (inputTokenType == IoToken.Other) {
        wormholeFee = msg.value; //same as above
        (approveCheck, offset) = params.asBoolUnchecked(offset);
        (inputToken,  offset) = parseIERC20(params, offset);
        (inputAmount, offset) = params.asUint128Unchecked(offset);
        offset = _acquireInputTokens(inputAmount, inputToken, params, offset);
      }
      else
        _assertExhaustive();
      // @audit: the path is always inputToken => usdc
>>    (uint256 deadline, uint outputAmount, uint swapType, bytes memory path, ) =
        parseEvmSwapParams(address(inputToken), address(_usdc), params, offset);

      //adjust outputAmount to ensure that the received usdc amount on the target chain is at least
      //  the specified outputAmount
      outputAmount += totalFee;

      uint inOutAmount = _swap(
        swapType,
>>      mos.isExactIn,
        inputAmount,
        outputAmount,
        inputToken,
        _usdc,
        true, //revert on failure
        approveCheck,
        deadline,
        path
      );
```

Let's take a look at the `_swap` function parameters:

- `inputAmount` is the tokens that user transfers to the SwapLayer and wants to swap for USDC;
- `outputAmount` is a slippage control value in case of `isExactIn == true` or the USDC amount after swap if `isExactIn == false`;
- `path` is the encoded `tokenIn-...-tokenOut` path for the router, that is received from the `parseEvmSwapParams` function, in our case it always `inputToken => USDC`:

```solidity
function parseEvmSwapParams(
  address inputToken,
  address outputToken,
  bytes memory params,
  uint offset
) pure returns (uint, uint, uint, bytes memory, uint) { unchecked {
  ---SNIP---
  bytes memory partialPath;
  (partialPath, offset) = params.sliceUnchecked(offset, sliceLen);
>> bytes memory path = abi.encodePacked(inputToken, firstPoolId, partialPath, outputToken);
  return (deadline, outputAmount, swapType, path, offset);
}}
```

Now, let's check the `SwapLayerUniswapV3R.sol` contract that will make a swap for us:

```solidity
  function _uniswapSwap(
    bool isExactIn,
    uint inputAmount,
    uint outputAmount,
    IERC20 inputToken,
    IERC20, //outputToken
    bool revertOnFailure,
    bool approveCheck,
    bytes memory path
  ) internal override returns (uint /*inOutAmount*/) {
    if (approveCheck && inputToken.allowance(address(this), _uniswapRouter) < inputAmount)
      _maxApprove(inputToken, _uniswapRouter);

>>  SwapParams memory swapParams =
      SwapParams(path, address(this), block.timestamp, inputAmount, outputAmount);

    bytes memory funcCall = abi.encodeWithSelector(
      isExactIn
      ? IUniswapV3SwapRouter.exactInput.selector
      : IUniswapV3SwapRouter.exactOutput.selector,
      (swapParams)
    );
```

It can be observed that the same `SwapParams` are used for `exactInput` and `exactOutput` functions. However, Uniswap V3 router expects reverse path if the `exactOutput` is called, on top of that `inputAmount` and `outputAmount` should trade places. The correct implementation can be found in the `SwapLayerUniswapUR.sol` contract:

<https://github.com/code-423n4/2024-07-audit-402/blob/main/evm/src/assets/SwapLayerUniswapUR.sol#L66-L94>

### Recommended Mitigation Steps

Implement the same algorithm like in the `SwapLayerUniswapUR.sol` to reverse the path and correctly use `inputAmount` and `outputAmount` variables, if the `isExactIn == false` is specified.

### Assessed type

Uniswap

**[djb15 (Audit 402) confirmed and commented](https://github.com/code-423n4/2024-07-audit-402-findings/issues/7#issuecomment-2234794406):**
 > We forgot to point out that the code for the V3 router is stale and only for reference. But yes, this is absolutely correct, nice catch. We've deleted the V3 router in [this commit](https://github.com/XLabs/swap-layer/commit/0694326144bbb38d341b9553d287a6c94fa15d25).

**[0xsomeone (judge) commented](https://github.com/code-423n4/2024-07-audit-402-findings/issues/7#issuecomment-2239045959):**
 > The Warden has highlighted how the code will fail to execute an exact output swap using the `UniswapV3R` router during an `initiate` call as it fails to reverse the swap path before supplying it to the router.
> 
> As the `SwapLayerUniswapV3R` contract was in the scope of the audit, all submissions in relation to it are eligible for a reward. In this case, a medium severity rating is appropriate as the inexecutability of the outlined code path is a non-blocking factor to the overall cross-chain flows supported by the Swap Layer.

***

# Low Risk and Non-Critical Issues

For this audit, 4 reports were submitted by wardens detailing low risk and non-critical issues. The [report highlighted below](https://github.com/code-423n4/2024-07-audit-402-findings/issues/9) by **ladboy233** received the top score from the judge.

*The following wardens also submitted reports: [Ch\_301](https://github.com/code-423n4/2024-07-audit-402-findings/issues/25), [SpicyMeatball](https://github.com/code-423n4/2024-07-audit-402-findings/issues/20), and [monrel](https://github.com/code-423n4/2024-07-audit-402-findings/issues/27).*

## [01] `Permit`/`Permit2` is subject to frontrunning and denial of service when acquiring USDC token

When a user initiates the transfer by calling initial, the code logic involves acquiring USDC token.

```solidity
else if (acquireMode == AcquireMode.Permit) {
      uint256 value; uint256 deadline; bytes32 r; bytes32 s; uint8 v;
      (value, deadline, r, s, v, offset) = parsePermit(params, offset);
 @     IERC20Permit(address(inputToken)).permit(msg.sender, address(this), value, deadline, v, r, s);
      inputToken.safeTransferFrom(msg.sender, address(this), inputAmount);
    }
    else if (acquireMode == AcquireMode.Permit2Transfer) {
      uint256 amount; uint256 nonce; uint256 sigDeadline; bytes memory signature;
      (amount, nonce, sigDeadline, signature, offset) = parsePermit2Transfer(params, offset);
  @    _permit2.permitTransferFrom(
        ISignatureTransfer.PermitTransferFrom({
          permitted: ISignatureTransfer.TokenPermissions(address(inputToken), amount),
          nonce: nonce,
          deadline: sigDeadline
        }),
        ISignatureTransfer.SignatureTransferDetails(address(this), inputAmount),
        msg.sender,
        signature
      );
    }
    else if (acquireMode == AcquireMode.Permit2Permit) {
      uint160 amount; uint48 expiration; uint48 nonce; uint256 sigDeadline; bytes memory signature;
      (amount, expiration, nonce, sigDeadline, signature, offset) =
        parsePermit2Permit(params, offset);
@      _permit2.permit(
        msg.sender,
        IAllowanceTransfer.PermitSingle({
          details: IAllowanceTransfer.PermitDetails(address(inputToken), amount, expiration, nonce),
          spender: address(this),
          sigDeadline: sigDeadline
        }),
        signature
      );
```

If the user selects the [AcquireMode.Permit](https://github.com/code-423n4/2024-07-audit-402/blob/0b6c3ed4883c1ef1a725b6c235abe71a9fd6e0cb/evm/src/assets/SwapLayerInitiate.sol#L223), a malicious user can frontrun user's transaction by consuming the signature first, then calling:

```solidity
IERC20Permit(address(inputToken)).permit(msg.sender, address(this), value, deadline, v, r, s);
```

Calling again will revert because the nonce that match the signature is already consumed.

Reference [here](https://www.trust-security.xyz/post/permission-denied).

If the user select the `AcquireMode.Permit2Permit`, the user can permissionlessly [consume the `permit2` signature first](https://github.com/Uniswap/permit2/blob/cc56ad0f3439c502c246fc5cfcc3db92bb8b7219/src/AllowanceTransfer.sol#L33) and then the transaction reverts if the code attempts to consume the same signature again.

```solidity
_permit2.permit(
        msg.sender,
        IAllowanceTransfer.PermitSingle({
          details: IAllowanceTransfer.PermitDetails(address(inputToken), amount, expiration, nonce),
          spender: address(this),
          sigDeadline: sigDeadline
        }),
        signature
      );
```

It is recommended to `try catch` the permit call to make sure even the permit fails, the code should try to transfer the fund to avoid such DOS.

## [02] If a recipient address cannot receive ETH, the `redeem` always reverts and fails.

When message is redeemed, even the swap can be from USDT to WETH, the code always try to convert WETH to ETH.

Then, it sends the `ETH + the gas` drop out:

```solidity
   if (outputTokenType == IoToken.Gas) {f
      _wnative.withdraw(outputAmount);
      outputAmount = outputAmount + gasDropoff;
      _transferEth(sms.recipient, outputAmount);
    }
    else {
      if (gasDropoff > 0)
        _transferEth(sms.recipient, gasDropoff);

      outputToken.safeTransfer(sms.recipient, outputAmount);
    }
```

`_transferETH` always [sends ETH](https://github.com/code-423n4/2024-07-audit-402/blob/0b6c3ed4883c1ef1a725b6c235abe71a9fd6e0cb/evm/src/assets/SwapLayerRedeem.sol#L144) to the recipient:

```solidity
 function _transferEth(address to, uint256 amount) internal {
    (bool success, ) = to.call{value: amount}(new bytes(0));
    if (!success)
      revert EthTransferFailed();
  }
```

However, if the recipient address is a smart contract that is not capable of receiving ETH, transaction revert and funds are locked. It is recommended to transfer WETH instead of ETH out to avoid such issue.

## [03] Tokens that revert in large approval/transfer is not compatible with the current implementation

There is a [function `_maxApprove`](https://github.com/code-423n4/2024-07-audit-402/blob/0b6c3ed4883c1ef1a725b6c235abe71a9fd6e0cb/evm/src/assets/SwapLayerBase.sol#L66):

```solidity
  function _maxApprove(IERC20 token, address spender) internal {
    SafeERC20.forceApprove(token, spender, type(uint256).max);
  }
```

Then, the smart contract triggers approve to `type(256).max`. However, according to [this doc](https://github.com/d-xo/weird-erc20?tab=readme-ov-file#revert-on-large-approvals--transfers):

> Some tokens (e.g. UNI, COMP) revert if the value passed to approve or transfer is larger than uint96.

For example, [this](https://etherscan.io/token/0x1f9840a85d5af5bf1d1762f925bdaddc4201f984#code#L340
) is the UNI token implement of approval and the protocol clearly says that the token that reverts in large approval or transfer is in-scope [here](https://github.com/code-423n4/2024-07-audit-402?tab=readme-ov-file).

The impact is that the token that reverts in large approval is not compatible with the current implementation and user cannot swap from UNI to USDC when initializing the transaction, because the logic involves swap from UNI to USDC and the code needs to approve the router contract as a spender before making a swap.

## [04] Output token is not validated in `_traderJoeSwap`

In [`_traderJobSwap`](https://github.com/code-423n4/2024-07-audit-402/blob/0b6c3ed4883c1ef1a725b6c235abe71a9fd6e0cb/evm/src/assets/SwapLayerTraderJoe.sol#L47):

```solidity
  function _traderJoeSwap(
    bool isExactIn,
    uint inputAmount,
    uint outputAmount,
    IERC20 inputToken,
    IERC20, //outputToken // @audit, why?
    bool revertOnFailure,
    bool approveCheck,
    bytes memory path
  ) internal override returns (uint /*inOutAmount*/) { unchecked {
```

We can see the parameter `outputToken` is not validated, which allows users to pass in a `outputToken` but compose the payload to pass in the swap path and produce a different output token.

The impact has its limitation. While the user can spoof the USDC return out when initializing the transaction, this means a user can swap the input token to a fake token but return a large amount of `inOutAmount`. 

```solidity
uint inOutAmount = _swap(
swapType,
mos.isExactIn,
inputAmount,
outputAmount,
inputToken,
_usdc,
true, //revert on failure
approveCheck,
deadline,
path
);

if (mos.isExactIn)
finalAmount = inOutAmount;
```

The `finalAmount` becomes `usdcAmount`, and when calling the function:

```solidity
_liquidityLayer.placeFastMarketOrder{value: wormholeFee}(
    usdcAmount,
    targetChain,
    peer,
    swapMessage,
    maxFastFee,
    fastTransferDeadline
)
```

If the function `_liquidityLayer` implements correctly and transfers the `usdcAmount` out, the transaction still reverts.

## [05] Lack of handling for overpaid/underpaid `msg.value` fees when initiating the transaction

When initiating the transaction, the user needs to [pay the `wormHole` fee](https://github.com/code-423n4/2024-07-audit-402/blob/0b6c3ed4883c1ef1a725b6c235abe71a9fd6e0cb/evm/src/assets/SwapLayerInitiate.sol#L128):

```solidity
  if (inputTokenType == IoToken.Usdc) {
      //we received USDC directly
      wormholeFee = msg.value; //we save the gas for an STATICCALL to look up the wormhole msg fee
                               //and rely on the liquidity layer to revert if msg.value != fee
      (finalAmount, offset) = params.asUint128Unchecked(offset);
      if (mos.isExactIn) {
        if (finalAmount < totalFee)
          revert InsufficientInputAmount(finalAmount, totalFee);
      }
      else
        finalAmount += totalFee;

      _acquireInputTokens(finalAmount, _usdc, params, offset);
    }
```

However, all `msg.value` is forwarded to liquidity layer as fee when [placing the order](https://github.com/code-423n4/2024-07-audit-402/blob/0b6c3ed4883c1ef1a725b6c235abe71a9fd6e0cb/evm/src/assets/SwapLayerInitiate.sol#L101):

```solidity
 _liquidityLayer.placeFastMarketOrder{value: wormholeFee}(
          usdcAmount,
          targetChain,
          peer,
          swapMessage,
          maxFastFee,
          fastTransferDeadline
        );
```

If the user overpays the `wormholeFee`, there is lack of refund logic. If the user underpays the `wormholeFee`, there is lack of input validation to ensure that sufficient fee is paid to make sure the market order gets filled.

## [06] Address open TODOs

The protocol should ensure that all open TODO's are addressed.

```
src/assets/Params.sol:
  12  
  13: uint16 constant SOLANA_CHAIN_ID = 1; //TODO this should come from elsewhere
  14  

src/assets/SwapLayerRelayingFees.sol:
   56  // is this accurate?
   57: //TODO the following are estimates from forge tests (already adjusted upwards for more guardians
   58  //     on mainnet) - refine further with testnet measurements (+guardian count adjustments!)

  156      if (targetChain == SOLANA_CHAIN_ID) {
  157:       //TODO figure out what other (dynamic) fees might go into Solana fee calculations
  158        if (swapCount != 0 && swapType != SWAP_TYPE_JUPITERV6)

src/assets/SwapLayerUniswapUR.sol:
  67        {
  68:         //TODO either eventually replace this with proper memcpy or adjust parseEvmSwapParams
  69          //     so it expects an inverse path order for exact out swaps in case of uniswap and
```

***

# Disclosures

C4 is an open organization governed by participants in the community.

C4 audits incentivize the discovery of exploits, vulnerabilities, and bugs in smart contracts. Security researchers are rewarded at an increasing rate for finding higher-risk issues. Audit submissions are judged by a knowledgeable security researcher and solidity developer and disclosed to sponsoring developers. C4 does not conduct formal verification regarding the provided code but instead provides final verification.

C4 does not provide any guarantee or warranty regarding the security of this project. All smart contract software should be used at the sole risk and responsibility of users.
