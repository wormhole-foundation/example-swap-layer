import * as base from "@wormhole-foundation/sdk-base";
import {
  uniswapUniversalRouter,
  uniswapV3PositionManager,
  traderJoeRouter,
  permit2Contract
} from "@xlabs/wh-swap-layer-ts-sdk";

import { writeFileSync } from "fs";

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

function errorExit(missing: string): never {
  console.error(`No ${missing} for ${network} ${chain}`);
  process.exit(1);
}

const rpc = base.rpc.rpcAddress(network, chain);
if (!rpc) errorExit(`RPC url`);

if (!uniswapUniversalRouter.has(network, chain))
  errorExit(`Uniswap Universal Router`);

if (!uniswapV3PositionManager.has(network, chain))
  errorExit(`Uniswap Position Manager`);

if (!traderJoeRouter.has(network, chain))
  errorExit(`TraderJoe Router`);

if (!base.circle.usdcContract.has(network, chain))
  errorExit(`USDC contract`);

const tokenMessenger = base.contracts.circleContracts.get(network, chain)?.tokenMessenger;
if (!tokenMessenger)
  errorExit(`Circle tokenMessenger`);

const wrappedNative = base.tokens.getTokenByKey(
  network, chain, base.tokens.getNative(network, chain)?.wrapped?.symbol || ""
)?.address;
if (!wrappedNative)
  errorExit(`wrapped native token`);

const testVars =
`TEST_RPC=${rpc}
TEST_PERMIT2_ADDRESS=${permit2Contract}
TEST_WNATIVE_ADDRESS=${wrappedNative}
TEST_USDC_ADDRESS=${base.circle.usdcContract.get(network, chain)!}
TEST_CCTP_TOKEN_MESSENGER_ADDRESS=${tokenMessenger}
TEST_UNISWAP_ROUTER_ADDRESS=${uniswapUniversalRouter.get(network, chain)!}
TEST_UNISWAP_V3_POSITION_MANAGER_ADDRESS=${uniswapV3PositionManager.get(network, chain)!}
TEST_TRADERJOE_ROUTER_ADDRESS=${traderJoeRouter.get(network, chain)!}
TEST_WORMHOLE_ADDRESS=${base.contracts.coreBridge.get(network, chain)!}
`;

writeFileSync("testing.env", testVars);
