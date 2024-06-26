# Swap Layer

## Basics

The basic premise of the Swap Layer contract is to compose on top of the [Liquidity Layer](https://github.com/wormhole-foundation/example-liquidity-layer/) to facilitate any-token-to-any-token transfers cross-chain via USDC/CCTP as the "liquidity highway asset", Uniswap/TraderJoe and Jupiter for swaps to and from USDC on EVM and Solana respectively, and Wormhole general-message-passing (GMP) for transmitting additional information.

In a nutshell, the Liquidity Layer is a more advanced version of the [Wormhole Circle Integration](https://github.com/wormhole-foundation/wormhole-circle-integration), which allows composing CCTP transfers with Wormhole GMP. For slow finality chains, the Liquidity Layer additionally offers a fast transfer mode, which emits an instant finality message on the source chain, which then kicks off an auction to front the transferred USDC on Solana (a fast finality chain) so it can be taken to the target chain from there. The original funds (i.e. the USDC CCTP transfer originating from the source chain) are subsequently routed to the auction winner once the slower CCTP attestation becomes available.

## Flow

As with all cross-chain workflows, there are two legs to any Swap Layer transfer:
1. initiating the transfer on the source chain via `initiate` (in `src/SwapLayerInitiate.sol`)
2. redeeming the transfer on the target chain via `redeem` (in `src/SwapLayerRedeem.sol`)

While both `initiate` and `redeem` can contain an optional swap step, depending on the choice of input and output token, they make different guarantees about the outcome. Failing to swap into USDC as part of the `initiate` call always causes a transaction to revert. However, to avoid funds getting stuck, a swap failures in `redeem` will simply result in the recipient receiving the intermediate USDC amount instead.

### Initiate

Every `initiate` call has 3 independent parts:
1. whether the underlying Liquidity Layer transfer is fast or not
2. the `RedeemMode` (in `src/assets/Params.sol`) of the transfer, which can be
  1. either `Direct` - just a normal, permissionless transfer
  2. or `Payload` - the transfer includes an integrator payload and can only be redeemed by the specified recipient
  3. or `Relay` - the redeem transaction should be submitted to the target chain by the Swap Layer's designated relayer with an optional gas dropoff (a specified amount of native gas tokens of the target chain provided by the relayer), using a portion of the transferred USDC to pay for the service
3. the desired input and output tokens/swaps

The following analogy with [Wormhole's Token Bridge](https://github.com/wormhole-foundation/wormhole/blob/main/ethereum/contracts/bridge/Bridge.sol) and [the associated Token Bridge Relayer (TBR)](https://github.com/wormhole-foundation/example-token-bridge-relayer/blob/main/README.md#design) regarding the `RedeemMode` might be helpful:
1. `Direct` corresponds to a plain [transferTokens](https://github.com/wormhole-foundation/wormhole/blob/dc3a6cf804137525239dbdb69cd56687322f8d50/ethereum/contracts/bridge/Bridge.sol#L166)
2. `Payload` is like [transferTokensWithPayload](https://github.com/wormhole-foundation/wormhole/blob/dc3a6cf804137525239dbdb69cd56687322f8d50/ethereum/contracts/bridge/Bridge.sol#L203)
3. `Relay` is analogous to TBR's [transferTokensWithRelay](https://github.com/wormhole-foundation/example-token-bridge-relayer/blob/d9d17254dae48c985fe6b58e2987e2135d1e8c65/evm/src/token-bridge-relayer/TokenBridgeRelayer.sol#L99C14-L99C37)

One important difference between the TBR and the Swap Layer however is that Swap Layer fees are calculated in their totality (both the cost of the relay itself as well as the requested gas dropoff) as part of the `initiate` call on the source chain and are always taken from the USDC that's being tranferred (rather than any input or output token).

As mentioned above, a swap failure during `initiate` will always cause the transaction to revert.

A successful `initiate` invocation will emit a Liquidity Layer message that contains a Swap Layer message in its payload. The Swap Layer message (in `src/assets/Message.sol`) in turn contains the intended recipient on the target chain, the desired output swap/token, and the `RedeemMode` and its associated information, namely the integrator payload, or the relaying fee and requested gas dropoff in case of `Payload` and `Relay` respectively.

### Redeem

Every `redeem` call requires a Liquidity Layer VAA and its associated CCTP attestation. Additionally, conditional on the `RedeemMode` of the transfer and the caller of `redeem`, different options and restrictions apply:
* While `Direct` and `Relay` transfers can be permissionlessly submitted by anyone, `Payload` transfers can only be redeemed by the specified recipient.
* If a `Relay` transfer is submitted by the transfer recipient themselves, no fees are charged. Otherwise the gas dropoff (i.e. `msg.value` that's transferred to the recipient) must match the value in the Swap Layer message before the relaying fee is transferred to the Swap Layer's reward address (as with the TBR, the rationale is to prevent MEV exploitation of the relayer and to keep rewards concentrated in a single address rather than have it diffuse over many different relaying wallets).
* When the specified recipient themselves invoke `redeem`, they are free to override the output swap/token that was specified in the Swap Layer message. This is primarily intended to allow users to specify the slippage of the output swap at the time of redemption, rather than initiation. Calls to `redeem` by third parties will simply execute the swap that's specified in the Swap Layer message (if applicable).

---
Note: The first and last point together imply that if a user initiated a transfer on the source chain and specified USDC as the output token on the target chain with the intention of overriding that instruction with their actually desired output swap when redeeming their transfer on the target chain, they could find themselves preempted by a third party that submits their transfer as in in their place, thus causing them to receive USDC.

This is not considered a problem because swaps that fail upon redemption will transfer USDC to the recipient regardless (i.e. the recipient receiving USDC is always a possibility regardless) and because in such a case the recipient is free to just execute their desired swap in a separate transaction themselves. Ultimately, any such "attacker" would therefore only end up paying the gas costs for verifying the attestations with no actual drawback to the recipient (in fact they end up saving gas) and the tangible upshot is that users can be helped by third parties in case they run into any issues by having their transfer redeemed for them.
---

## Files / Repo Structure

### Contract Inheritance diagram

SwapLayer (SL) files in `src` and `src/assets` directories, `ProxyBase` from [Wormhole's Solidity SDK pending PR branch](https://github.com/wormhole-foundation/wormhole-solidity-sdk/tree/post-merged).

```
    ┌─> SL-UniswapUR        ┌─> SL-Query  ─┬─> SL-Governance ─┬─> ProxyBase
SL ─┼─> SL-SansRouterImpls ─┼─> SL-Redeem ─┘                  └─┬─> SL-RelayingFees ─> SL-Base
    └─> SL-TraderJoe        └─> SL-Initiate ────────────────────┘
```

### Parameter Encoding & Integrator Library

Given the large number of combinations to invoke both `initiate` and `redeem` it would be impractical (as well as highly gas inefficient, since every additional public function that exists on a contract incurs a gas overhead on every contract call of 11 gas on average) to overload these functions for every possible combination. Therefore, the Swap Layer implements a custom parameter encoding (see `src/ISwapLayer.sol` and `src/assets/InitiateParams.sol`).

To make integrator's lives easier `SwapLayerIntegration` (and its base `SwapLayerIntegrationBase`) offer a solution that's much closer to a normal Solidity contract interface, and that take care of all the parameter encoding. While these contracts (that are only contracts for technical reasons and should rather be thought of as libraries) are very large (because they do expand a lot of the aforementioned combinatorial complexity), all code that's unused by an integrator will be dropped, which should result in an acceptable overhead.


# Dev Notes

## Smart Contract

See code comments throughout the code base.

In particular, see general remarks in `src/SwapLayerSansRouterImpls.sol`.

## Running ts-scripts

Start in `evm` directory:
`npm ci`

Build the ethers contracts:
` make build`

Build the sdk:
`cd ts-sdk && npm ci && npm run build`

Then configure `.env` with your private keys before finally running the scripts via `package.json`.
 