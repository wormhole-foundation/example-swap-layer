import * as base from "@wormhole-foundation/sdk-base";
import { uniswapV3SwapRouter, uniswapV3PositionManager, permit2Contract } from "./uniswap";

import { writeFileSync } from "fs";

function errorExit(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (process.argv.length != 4)
  errorExit("Usage: <network (e.g. Mainnet)> <chain (e.g. Ethereum)>");

const network = (() => {
  const network = process.argv[2];
  if (!base.network.isNetwork(network))
    errorExit(`Invalid network: ${network}`);

  return network;
})();

const chain = (() => {
  const chain = process.argv[3];
  if (!base.chain.isChain(chain))
    errorExit(`Invalid chain: ${chain}`);

  return chain;
})();

const foreignChain = chain === "Ethereum" ? "Avalanche" : "Ethereum";

const rpc = base.rpc.rpcAddress(network, chain);
if (!rpc)
  errorExit(`No RPC address for ${network} ${chain}`);

if (!uniswapV3PositionManager.has(network, chain))
  errorExit(`No Uniswap Position Manager for ${network} ${chain}`);

if (!base.circle.usdcContract.has(network, chain))
  errorExit(`No USDC contract for ${network} ${chain}`);

const tokenMessenger = base.contracts.circleContracts.get(network, chain)?.tokenMessenger;
if (!tokenMessenger)
  errorExit(`No Circle tokenMessenger contract for ${network} ${chain}`);

const testVars =
`TEST_RPC=${rpc}
TEST_FOREIGN_CHAIN_ID=${base.chainToChainId(foreignChain)}
TEST_FOREIGN_CIRCLE_DOMAIN=${base.circle.circleChainId(foreignChain)}
TEST_WORMHOLE_ADDRESS=${base.contracts.coreBridge.get(network, chain)!}
TEST_USDC_ADDRESS=${base.circle.usdcContract.get(network, chain)!}
TEST_FOREIGN_USDC_ADDRESS=${base.circle.usdcContract.get(network, foreignChain)!}
TEST_CCTP_TOKEN_MESSENGER_ADDRESS=${tokenMessenger}
TEST_UNISWAP_V3_SWAP_ROUTER_ADDRESS=${uniswapV3SwapRouter}
TEST_UNISWAP_V3_POSITION_MANAGER_ADDRESS=${uniswapV3PositionManager.get(network, chain)!}
TEST_PERMIT2_ADDRESS=${permit2Contract}
`;

writeFileSync("testing.env", testVars);
