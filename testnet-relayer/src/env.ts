import { ChainId } from "@certusone/wormhole-sdk";
import * as fs from "fs";
import { WebSocketProvider } from "./websocket";
import { Contract, ethers, Wallet } from "ethers";
import { Implementation } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { Implementation__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";

require("dotenv").config();

const CONFIG_DIR = "../ts-scripts/config/testnet/";
const CHAIN_CONFIG = CONFIG_DIR + "chains.json";
const CONTRACT_CONFIG = CONFIG_DIR + "contracts.json";
const WORMHOLE_RPC_HOSTS = ["https://api.testnet.wormholescan.io/api/v1/"];

type Environment = {
  privateKey: Uint8Array;
  guardianRpcs: string[];
  chains: ChainInfo[];
};

type ChainInfo = {
  description: string;
  evmNetworkId: number;
  chainId: ChainId;
  //rpc: string;
  rpcWs: string;
  wormholeAddress: string;
  liquidityLayerAddress: string;
  uniswapV3RouterAddress: string;
  permit2Address: string;
  usdcAddress: string;
  circleMessageTransmitter: string;
  circleDomain: number;
  provider: WebSocketProvider;
  signer: ethers.Wallet;
  wormholeContract: Implementation;

  //TODO this
  swapLayerAddress: string;
};

export function createEnvironment(): Environment {
  let output: any = {};
  const strip0x = (str: string) =>
    str.startsWith("0x") ? str.substring(2) : str;

  // shared EVM private key
  const ethKey = process.env.ETH_KEY;
  if (!ethKey) {
    console.error("ETH_KEY is required!");
    process.exit(1);
  }
  const PK = new Uint8Array(Buffer.from(strip0x(ethKey), "hex"));
  output.privateKey = PK;

  //read CHAIN_CONFIG sync
  const buffer = fs.readFileSync(CHAIN_CONFIG, "utf8");

  let parsed = JSON.parse(buffer);
  console.log(parsed);
  output.chains = parsed.chains as ChainInfo[];

  //loop to sanity check the chain info
  for (let i = 0; i < output.chains.length; i++) {
    let chain = output.chains[i];
    if (chain.chainId == null) {
      console.error("Chain ID is required!");
      process.exit(1);
    }
    if (chain.evmNetworkId == null) {
      console.error("EVM Network ID is required!");
      process.exit(1);
    }
    // Not currently used.
    // if (chain.rpc == null) {
    //   console.error("RPC URL is required!");
    //   process.exit(1);
    // }
    if (chain.rpcWs == null) {
      console.error("RPC WS URL is required!");
      process.exit(1);
    }
    if (chain.wormholeAddress == null) {
      console.error("Wormhole address is required!");
      process.exit(1);
    }
    if (chain.liquidityLayerAddress == null) {
      console.error("Liquidity layer address is required!");
      process.exit(1);
    }
    if (chain.uniswapV3RouterAddress == null) {
      console.error("Uniswap V3 Router address is required!");
      process.exit(1);
    }
    if (chain.permit2Address == null) {
      console.error("Permit2 address is required!");
      process.exit(1);
    }
    if (chain.usdcAddress == null) {
      console.error("USDC address is required!");
      process.exit(1);
    }
    if (chain.circleMessageTransmitter == null) {
      console.error("Circle message transmitter address is required!");
      process.exit(1);
    }
    if (chain.circleDomain == null) {
      console.error("Circle domain is required!");
      process.exit(1);
    }
    if (chain.swapLayerAddress == null) {
      console.error("Swap layer address is required!");
      process.exit(1);
    }

    chain.provider = new WebSocketProvider(chain.rpcWs);
    chain.signer = new Wallet(PK, chain.provider);
    chain.wormholeContract = Implementation__factory.connect(
      chain.wormholeAddress,
      chain.provider
    );
  }

  output.guardianRpcs = WORMHOLE_RPC_HOSTS;

  return output;
}

export function getChainInfo(env: Environment, chain: ChainId) {
  const item = env.chains.find((c) => c.chainId === chain);
  if (!item) {
    throw new Error("Chain not found in environment: " + chain);
  }
  return item;
}
