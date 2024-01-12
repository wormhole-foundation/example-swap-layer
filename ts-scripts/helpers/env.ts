import { ChainId } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import fs from "fs";

import { Create2Factory__factory } from "../../ethers-contracts-external/Create2Factory.sol";
import { Create2Factory } from "../../ethers-contracts-external/Create2Factory.sol/Create2Factory";
import { proxyContractSalt, setupContractSalt } from "./deployments";
import {
  Proxy__factory,
  SwapLayer,
  SwapLayer__factory,
  Proxy,
} from "../../ethers-contracts"; //TODO typechain

export type ChainInfo = {
  evmNetworkId: number;
  chainId: ChainId;
  chainName: //TODO import and use the correct type here
  | "Ethereum"
    | "Avalanche"
    | "Optimism"
    | "Arbitrum"
    | "Base"
    | "Solana"
    | "Terra"
    | "Bsc"
    | "Polygon"
    | "Oasis"
    | "Algorand"
    | "Aurora"
    | "Fantom"
    | "Karura"
    | "Acala"
    | "Klaytn"
    | "Celo"
    | "Near"
    | "Moonbeam"
    | "Neon"
    | "Terra2"
    | "Injective"
    | "Osmosis"
    | "Sui"
    | "Aptos"
    | "Gnosis"
    | "Pythnet"
    | "Xpla"
    | "Btc"
    | "Sei"
    | "Rootstock"
    | "Wormchain"
    | "Cosmoshub"
    | "Evmos"
    | "Kujira"
    | "Sepolia";
  rpc: string;
  wormholeAddress: string;
  uniswapV3RouterAddress: string;
  permit2Address: string;
  liquidityLayerAddress: string;
};

export type Deployment = {
  chainId: ChainId;
  address: string;
};

//TODO adjust types, potentially use typescript object
export type FeeConfig = {
  chainId: ChainId;
  baseFee: string;
  gasPrice: string;
  gasPriceMargin: string;
  gasPriceTimestamp: string;
  gasPriceUpdateThreshold: string;
  maxGasDropoff: string;
  gasDropoffMargin: string;
  gasTokenPrice: string;
};

export type SwapLayerConfig = {
  shouldRegisterEndpoints: boolean;
  shouldUpdateAssistant: boolean;
  shouldSweepTokens: boolean;
  shouldUpdateFeeRecipient: boolean;
  newAssistantAddress: string;
  newFeeRecipient: string;
};

const DEFAULT_ENV = "testnet";

export let env = "";
let lastRunOverride: boolean | undefined;

export function init(overrides: { lastRunOverride?: boolean } = {}): string {
  env = get_env_var("ENV");
  if (!env) {
    console.log(
      "No environment was specified, using default environment files"
    );
    env = DEFAULT_ENV;
  }
  lastRunOverride = overrides?.lastRunOverride;

  require("dotenv").config({
    path: `./ts-scripts/.env${env != DEFAULT_ENV ? "." + env : ""}`,
  });
  return env;
}

function get_env_var(env: string): string {
  const v = process.env[env];
  return v || "";
}

function getContainer(): string | null {
  const container = get_env_var("CONTAINER");
  if (!container) {
    return null;
  }

  return container;
}

export function loadScriptConfig(processName: string): any {
  const configFile = fs.readFileSync(
    `./ts-scripts/config/${env}/scriptConfigs/${processName}.json`
  );
  const config = JSON.parse(configFile.toString());
  if (!config) {
    throw Error("Failed to pull config file!");
  }
  return config;
}

export function getOperatingChains(): ChainInfo[] {
  const allChains = loadChains();
  const container = getContainer();
  let operatingChains: number[] | null = null;

  if (container == "evm1") {
    operatingChains = [2];
  }
  if (container == "evm2") {
    operatingChains = [4];
  }

  const chainFile = fs.readFileSync(`./ts-scripts/config/${env}/chains.json`);
  const chains = JSON.parse(chainFile.toString());
  if (chains.operatingChains) {
    operatingChains = chains.operatingChains;
  }
  if (!operatingChains) {
    return allChains;
  }

  const output: ChainInfo[] = [];
  operatingChains.forEach((x: number) => {
    const item = allChains.find((y) => {
      return x == y.chainId;
    });
    if (item) {
      output.push(item);
    }
  });

  console.log("Operating chains: " + output.map((x) => x.chainId).join(", "));

  return output;
}

export function loadChains(): ChainInfo[] {
  const chainFile = fs.readFileSync(`./ts-scripts/config/${env}/chains.json`);
  const chains = JSON.parse(chainFile.toString());
  if (!chains.chains) {
    throw Error("Failed to pull chain config file!");
  }
  return chains.chains;
}

export function getChain(chain: ChainId): ChainInfo {
  const chains = loadChains();
  const output = chains.find((x) => x.chainId == chain);
  if (!output) {
    throw Error("bad chain ID");
  }

  return output;
}

export function loadPrivateKey(): string {
  const privateKey = get_env_var("WALLET_KEY");
  if (!privateKey) {
    throw Error("Failed to find private key for this process!");
  }
  return privateKey;
}

export function loadGuardianSetIndex(): number {
  const chainFile = fs.readFileSync(`./ts-scripts/config/${env}/chains.json`);
  const chains = JSON.parse(chainFile.toString());
  if (chains.guardianSetIndex == undefined) {
    throw Error("Failed to pull guardian set index from the chains file!");
  }
  return chains.guardianSetIndex;
}

export function loadSwapLayers(): Deployment[] {
  const contractsFile = fs.readFileSync(
    `./ts-scripts/config/${env}/contracts.json`
  );
  if (!contractsFile) {
    throw Error("Failed to find contracts file for this process!");
  }
  const contracts = JSON.parse(contractsFile.toString());
  if (contracts.useLastRun || lastRunOverride) {
    const lastRunFile = fs.readFileSync(
      `./ts-scripts/output/${env}/deploySwapLayer/lastrun.json`
    );
    if (!lastRunFile) {
      throw Error(
        "Failed to find last run file for the deploySwapLayer process!"
      );
    }
    const lastRun = JSON.parse(lastRunFile.toString());
    return lastRun.SwapLayerProxies;
  } else if (contracts.useLastRun == false) {
    return contracts.SwapLayers;
  } else {
    throw Error("useLastRun was an invalid value from the contracts config");
  }
}

//leaving the code in for use-last-run despite the fact that the script doesn't exist in this repo.
export function loadWormholeRelayers(dev: boolean): Deployment[] {
  const contractsFile = fs.readFileSync(
    `./ts-scripts/config/${env}/contracts.json`
  );
  if (!contractsFile) {
    throw Error("Failed to find contracts file for this process!");
  }
  const contracts = JSON.parse(contractsFile.toString());
  if (contracts.useLastRun || lastRunOverride) {
    const lastRunFile = fs.readFileSync(
      `./ts-scripts/output/${env}/deployWormholeRelayer/lastrun.json`
    );
    if (!lastRunFile) {
      throw Error("Failed to find last run file for the Core Relayer process!");
    }
    const lastRun = JSON.parse(lastRunFile.toString());
    return lastRun.wormholeRelayerProxies;
  } else {
    return dev ? contracts.wormholeRelayersDev : contracts.wormholeRelayers;
  }
}

export function loadCreate2Factories(): Deployment[] {
  const contractsFile = fs.readFileSync(
    `./ts-scripts/config/${env}/contracts.json`
  );
  if (!contractsFile) {
    throw Error("Failed to find contracts file for this process!");
  }
  const contracts = JSON.parse(contractsFile.toString());
  if (contracts.useLastRun || lastRunOverride) {
    const lastRunFile = fs.readFileSync(
      `./ts-scripts/output/${env}/deployCreate2Factory/lastrun.json`
    );
    if (!lastRunFile) {
      throw Error(
        "Failed to find last run file for the deployCreate2Factory process!"
      );
    }
    const lastRun = JSON.parse(lastRunFile.toString());
    return lastRun.create2Factories;
  } else {
    return contracts.create2Factories;
  }
}

//TODO load these keys more intelligently,
//potentially from devnet-consts.
//Also, make sure the signers are correctly ordered by index,
//As the index gets encoded into the signature.
export function loadGuardianKeys(): string[] {
  const output: string[] = [];
  const NUM_GUARDIANS = get_env_var("NUM_GUARDIANS");
  const guardianKey = get_env_var("GUARDIAN_KEY");
  const guardianKey2 = get_env_var("GUARDIAN_KEY2");

  let numGuardians: number = 0;
  console.log("NUM_GUARDIANS variable : " + NUM_GUARDIANS);

  if (!NUM_GUARDIANS) {
    numGuardians = 1;
  } else {
    numGuardians = parseInt(NUM_GUARDIANS);
  }

  if (!guardianKey) {
    throw Error("Failed to find guardian key for this process!");
  }
  output.push(guardianKey);

  if (numGuardians >= 2) {
    if (!guardianKey2) {
      throw Error("Failed to find guardian key 2 for this process!");
    }
    output.push(guardianKey2);
  }

  return output;
}

export function writeOutputFiles(output: any, processName: string) {
  fs.mkdirSync(`./ts-scripts/output/${env}/${processName}`, {
    recursive: true,
  });
  fs.writeFileSync(
    `./ts-scripts/output/${env}/${processName}/lastrun.json`,
    JSON.stringify(output),
    { flag: "w" }
  );
  fs.writeFileSync(
    `./ts-scripts/output/${env}/${processName}/${Date.now()}.json`,
    JSON.stringify(output),
    { flag: "w" }
  );
}

export function getSigner(chain: ChainInfo): ethers.Wallet {
  let provider = getProvider(chain);
  let signer = new ethers.Wallet(loadPrivateKey(), provider);
  return signer;
}

export function getProvider(
  chain: ChainInfo
): ethers.providers.StaticJsonRpcProvider {
  let provider = new ethers.providers.StaticJsonRpcProvider(
    loadChains().find((x: any) => x.chainId == chain.chainId)?.rpc || ""
  );

  return provider;
}

export function loadGuardianRpc(): string {
  const chainFile = fs.readFileSync(`./ts-scripts/config/${env}/chains.json`);
  if (!chainFile) {
    throw Error("Failed to find contracts file for this process!");
  }
  const chain = JSON.parse(chainFile.toString());
  return chain.guardianRPC;
}

export function getSwapLayer(
  chain: ChainInfo,
  provider?: ethers.providers.StaticJsonRpcProvider
): SwapLayer {
  const thisChainsProvider = getSwapLayerAddress(chain);
  const contract = SwapLayer__factory.connect(
    thisChainsProvider,
    provider || getSigner(chain)
  );
  return contract;
}

export function getSwapLayerProxy(chain: ChainInfo): Proxy {
  const thisChainsProvider = getSwapLayerAddress(chain);
  const contract = Proxy__factory.connect(thisChainsProvider, getSigner(chain));
  return contract;
}

export function getSwapLayerAddress(chain: ChainInfo): string {
  const thisChainsOracle = loadSwapLayers().find(
    (x: any) => x.chainId == chain.chainId
  )?.address;
  if (!thisChainsOracle) {
    throw new Error(
      "Failed to find a SwapLayer contract address on chain " + chain.chainId
    );
  }
  return thisChainsOracle;
}

const wormholeRelayerAddressesCache: Partial<Record<ChainId, string>> = {};
export async function getWormholeRelayerAddress(
  chain: ChainInfo,
  forceCalculate?: boolean
): Promise<string> {
  // See if we are in dev mode (i.e. forge contracts compiled without via-ir)
  const dev = get_env_var("DEV") == "True" ? true : false;

  const contractsFile = fs.readFileSync(
    `./ts-scripts/config/${env}/contracts.json`
  );
  if (!contractsFile) {
    throw Error("Failed to find contracts file for this process!");
  }
  const contracts = JSON.parse(contractsFile.toString());
  //If useLastRun is false, then we want to bypass the calculations and just use what the contracts file says.
  if (!contracts.useLastRun && !lastRunOverride && !forceCalculate) {
    const thisChainsRelayer = loadWormholeRelayers(dev).find(
      (x: any) => x.chainId == chain.chainId
    )?.address;
    if (thisChainsRelayer) {
      return thisChainsRelayer;
    } else {
      throw Error(
        "Failed to find a WormholeRelayer contract address on chain " +
          chain.chainId
      );
    }
  }

  if (!wormholeRelayerAddressesCache[chain.chainId]) {
    const create2Factory = getCreate2Factory(chain);
    const signer = getSigner(chain).address;

    wormholeRelayerAddressesCache[chain.chainId] =
      await create2Factory.computeProxyAddress(signer, proxyContractSalt);
  }

  return wormholeRelayerAddressesCache[chain.chainId]!;
}

export function getCreate2FactoryAddress(chain: ChainInfo): string {
  const address = loadCreate2Factories().find(
    (x: any) => x.chainId == chain.chainId
  )?.address;
  if (!address) {
    throw new Error(
      "Failed to find a create2Factory contract address on chain " +
        chain.chainId
    );
  }
  return address;
}

export const getCreate2Factory = (chain: ChainInfo): Create2Factory =>
  Create2Factory__factory.connect(
    getCreate2FactoryAddress(chain),
    getSigner(chain)
  );

export const loadFeeConfig = (): FeeConfig[] => {
  const feeConfigFile = fs.readFileSync(
    `./ts-scripts/config/${env}/scriptConfigs/configureFees.json`
  );
  if (!feeConfigFile) {
    throw Error("Failed to find fee config file for this process!");
  }
  const feeConfig = JSON.parse(feeConfigFile.toString());
  return feeConfig;
};

export const loadSwapLayerConfiguration = (): SwapLayerConfig => {
  const configFile = fs.readFileSync(
    `./ts-scripts/config/${env}/scriptConfigs/configureSwapLayer.json`
  );
  if (!configFile) {
    throw Error("Failed to find config file for this process!");
  }
  const config = JSON.parse(configFile.toString());
  return config;
};
