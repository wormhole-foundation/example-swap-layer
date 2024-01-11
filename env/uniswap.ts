import { constMap, Network, Chain, RoArray } from "@wormhole-foundation/sdk-base";

//!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
//!!!!!!!!!!!!!!!!!!!!!!!!! DO NOT TRUST THE UNISWAP DOCS !!!!!!!!!!!!!!!!!!!!!!!!!
//!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
//
// The deployment addresses of the UniversalRouter
//   [in the docs](https://docs.uniswap.org/contracts/v3/reference/deployments)
//   do not match those
//   [in the repo](https://github.com/Uniswap/universal-router/tree/main/deploy-addresses).
//
// When you pick a chain, e.g. Polygon and look which address is the right one, it turns out that
//   not only is the exact same contract deployed to both addresses:
// - [0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD]
//     (https://polygonscan.com/address/0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad#code)
// - [0x643770E279d5D0733F21d6DC03A8efbABf3255B4]
//     (https://polygonscan.com/address/0x643770E279d5D0733F21d6DC03A8efbABf3255B4#code)
// but they also both have comparable transaction counts of 1,210k vs 770k!
//
// And this is not just some freak Polygon peculiarity. The same thing is true on e.g. Arbitrum:
// - [0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD]
//     (https://arbiscan.io/address/0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad)
// - [0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4]
//     (https://arbiscan.io/address/0xec8b0f7ffe3ae75d7ffab09429e3675bb63503e4)
// and again comparable transaction counts of 1,140k vs 801k.
//
// Worse:
// The docs list
//   [0x5302086A3a25d473aAbBd0356eFf8Dd811a4d89B]
//     (https://bscscan.com/address/0x5302086A3a25d473aAbBd0356eFf8Dd811a4d89B#code)
//   as the address for BSC... but when you follow the link, you'll see that what's actually
//   deployed there is a contract called `UnsupportedProtocol`. But
//   [0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD]
//     (https://bscscan.com/address/0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD#code)
//   exists, as does
//   [0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4]
//     (https://bscscan.com/address/0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4#code)
//   which is the address listed in the github repo.
//
// So while the docs explicitly state:
// > Integrators should **no longer assume that they are deployed to the same addresses across
// >    chains** and be extremely careful to confirm mappings below.
//
// You will actually shoot yourself in the foot by using the provided addresses, but will be fine
//   if you just use the same 0x3fC9... address everywhere, ..e. when you do **the exact opposite
// of what the docs tell you**.
//
// The deployment addresses of the V3-SwapRouter are equally unreliable.
//!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

const uniswapV3NonfungiblePositionManagerContracts = [[
  "Mainnet", [
    ["Ethereum",  "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
    ["Arbitrum",  "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
    ["Optimism",  "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
    ["Polygon",   "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
    ["Avalanche", "0x655C406EBFa14EE2006250925e54ec43AD184f8B"],
    ["Base",      "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1"],
    ["Bsc",       "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613"],
    ["Celo",      "0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A"],
  ]], [
  "Testnet", [
    ["Ethereum",  "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"], //Goerli
  ]],
] as const satisfies RoArray<readonly [Network, RoArray<readonly [Chain, string]>]>;


export const uniswapV3PositionManager = constMap(uniswapV3NonfungiblePositionManagerContracts);

//same across all chains/networks
export const uniswapV3SwapRouter = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
export const permit2Contract = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
