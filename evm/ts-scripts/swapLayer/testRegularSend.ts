import { tryNativeToUint8Array } from "@certusone/wormhole-sdk";
import { InitiateArgs, encodeInitiateArgs } from "../../ts-sdk";
import {
  TestSendConfig,
  getChain,
  getOperatingChains,
  getSigner,
  getSwapLayer,
  init,
  loadTestSendConfig,
} from "../helpers/env";

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
      encodedCommands,
      {
        value: config.sendGas ? BigInt(config.sendAmount) : 0n,
      }
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
    isExactIn: true,
    inputToken: {
      type: "Gas",
      // acquireMode: {
      //   mode: "Preapproved",
      // },
      swap: {
        deadline: parseInt(config.deadline),
        limitAmount: BigInt(config.limit),
        //amount: BigInt(config.sendAmount),
        type: {
          id: "UniswapV3",
          legFirstFee: parseInt(config.firstLegFee),
          path: [],
        },
      },
    },
  };

  return output;
}

run().then(() => console.log("Done!"));
