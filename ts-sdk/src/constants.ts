import { constMap, Network, Chain, MapLevel, MapLevels } from "@wormhole-foundation/sdk-base";

// ---- Uniswap addresses ----

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
//
// One possible reason why there might be multiple deployments of the same bytecode is that the
//   constructor arguments might differ, i.e. one version of the universal router might have the
//   address of the UnsupportedProtocol contract, while the redeployed version has a viable version.
//!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

const uniswapV3NonfungiblePositionManagerContracts = [[
  "Mainnet", [
    ["Ethereum",        "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
    ["Arbitrum",        "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
    ["Optimism",        "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
    ["Polygon",         "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
    ["Avalanche",       "0x655C406EBFa14EE2006250925e54ec43AD184f8B"],
    ["Base",            "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1"],
  ]], [
  "Testnet", [
    ["Sepolia",         "0x1238536071E1c677A632429e3655c799b22cDA52"],
    ["Polygon",         "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
    // ["Avalanche",       ""],
    // ["ArbitrumSepolia", ""],
    // ["BaseSepolia",     ""],
    // ["OptimismSepolia", ""],
  ]],
] as const satisfies MapLevels<[Network, Chain, string]>;

export const uniswapV3PositionManager = constMap(uniswapV3NonfungiblePositionManagerContracts);

// //same across all chains/networks (does not exist on sepolia)
// export const uniswapV3SwapRouter = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

const uniswapUniversalRouterContracts = [[
  "Mainnet", [
    ["Ethereum",        "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"],
    ["Arbitrum",        "0x5E325eDA8064b456f4781070C0738d849c824258"],
    ["Optimism",        "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"],
    ["Polygon",         "0xec7BE89e9d109e7e3Fec59c222CF297125FEFda2"],
    ["Avalanche",       "0x4Dae2f939ACf50408e13d58534Ff8c2776d45265"],
    ["Base",            "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"],
  ]], [
  "Testnet", [
    ["Sepolia",         "0x1238536071E1c677A632429e3655c799b22cDA52"],
    ["Polygon",         "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"],
    ["Avalanche",       "0x7353B29FDc79435dcC7ECc9Ac9F9b61d83B4E0F4"],
    // ["ArbitrumSepolia", ""],
    // ["BaseSepolia",     ""],
    // ["OptimismSepolia", ""],
  ]],
] as const satisfies MapLevels<[Network, Chain, string]>;

export const uniswapUniversalRouter = constMap(uniswapUniversalRouterContracts);

// ---- TraderJoe addresses ----

//see here: https://docs.traderjoexyz.com/deployment-addresses/avalanche

const traderJoeRouterContracts = [[
  "Mainnet", [
    ["Ethereum",  "0x9A93a421b74F1c5755b83dD2C211614dC419C44b"],
    ["Arbitrum",  "0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30"],
    ["Avalanche", "0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30"],
  ]], [
  "Testnet", [
    ["Avalanche", "0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30"],
  ]],
] as const satisfies MapLevels<[Network, Chain, string]>;

export const traderJoeRouter = constMap(traderJoeRouterContracts);

// ---- Permit2 address ----

export const permit2Contract = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

// ---- liquidity layer addresses ----

//only one matching engine per network on the respective hubchain
const matchingEngineContracts = [
  ["Testnet", { chain: "Avalanche", address: "0xdf5af760f3093034C7A6580FBd4CE66A8bEDd90A" }],
] as const satisfies MapLevel<Network, {chain: Chain, address: string}>;

export const matchingEngine = constMap(matchingEngineContracts);

const tokenRouterContracts = [[
  "Testnet", [
    ["Polygon",         "0x3Ce8a3aC230Eb4bCE3688f2A1ab21d986a0A0B06"],
    ["Avalanche",       "0x7353B29FDc79435dcC7ECc9Ac9F9b61d83B4E0F4"],
    ["Sepolia",         "0x603541d1Cf7178C407aA7369b67CB7e0274952e2"],
    ["ArbitrumSepolia", "0xc1Cf3501ef0b26c8A47759F738832563C7cB014A"],
    ["BaseSepolia",     "0x4452B708C01d6aD7058a7541A3A82f0aD0A1abB1"],
    ["OptimismSepolia", "0xc1Cf3501ef0b26c8A47759F738832563C7cB014A"],
  ]]
] as const satisfies MapLevels<[Network, Chain, string]>;

export const tokenRouter = constMap(tokenRouterContracts);
