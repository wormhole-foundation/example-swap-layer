import { tryNativeToUint8Array } from "@certusone/wormhole-sdk";
import {
  GovernanceCommand,
  InitiateArgs,
  encodeGovernanceCommandsBatch,
  encodeInitiateArgs,
} from "../../ts-sdk";
import {
  deploySwapLayerImplementation,
  deploySwapLayerProxy,
} from "../helpers/deployments";
import {
  ChainInfo,
  TestSendConfig,
  getChain,
  getOperatingChains,
  getSigner,
  getSwapLayer,
  getSwapLayerAddress,
  init,
  loadChains,
  loadPrivateKey,
  loadSwapLayerConfiguration,
  loadTestSendConfig,
  writeOutputFiles,
} from "../helpers/env";
import {
  UniversalAddress,
  toNative,
} from "@wormhole-foundation/sdk-definitions";
import { Wormhole } from "@wormhole-foundation/connect-sdk";
import { EvmPlatform } from "@wormhole-foundation/connect-sdk-evm";
import { get } from "http";
import { Signer } from "ethers";

const processName = "testBasicSendSwapLayer";
init();
const chains = getOperatingChains();

async function run() {
  console.log(`Start ${processName}!`);
  console.log(`Sending a test transfer...`);

  const config = loadTestSendConfig();
  const fromChain = getChain(config.fromChain);
  //const toChain = getChain(config.toChain); //TODO later

  const swapLayer = getSwapLayer(fromChain);
  const initiatedRequest = createInitiateArgs(config);
  const encodedCommands = encodeInitiateArgs(initiatedRequest);
  const recipient = tryNativeToUint8Array(
    await getSigner(fromChain).getAddress(),
    "ethereum"
  );

  try {
    const testSend = await swapLayer.initiate(
      config.toChain,
      recipient,
      true,
      encodedCommands
    );
    console.log("Successfully initiated transfer!");

    //TODO wait for the transfer to arrive on the target chain
  } catch (e) {
    console.error(e);
    console.log("Failed to initiate transfer on chain: " + fromChain);
    process.exit(1);
  }
}

function createInitiateArgs(config: TestSendConfig): InitiateArgs {
  const output: InitiateArgs = {
    fastTransferMode: {
      mode: "Disabled",
    },
    redeemMode: {
      mode: "Relay",
      gasDropoff: BigInt(0),
      maxRelayingFee: BigInt(1e14),
    },
    outputToken: {
      type: "Usdc",
    },
    inputToken: {
      type: "Gas",
      swap: {
        type: "Uniswap",
        limitAmount: BigInt(config.limit),
        deadline: parseInt(config.deadline),
        legFirstFee: parseInt(config.firstLegFee),
        path: [],
      },
    },
  };

  return output;
}

run().then(() => console.log("Done!"));
