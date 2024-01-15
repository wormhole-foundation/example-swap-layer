import { tryNativeToUint8Array } from "@certusone/wormhole-sdk";
import { GovernanceCommand, encodeGovernanceCommandsBatch } from "../../ts-sdk";
import {
  deploySwapLayerImplementation,
  deploySwapLayerProxy,
} from "../helpers/deployments";
import {
  ChainInfo,
  getOperatingChains,
  getSwapLayer,
  getSwapLayerAddress,
  init,
  loadChains,
  loadFeeConfig,
  loadPrivateKey,
  loadSwapLayerConfiguration,
  writeOutputFiles,
} from "../helpers/env";
import {
  UniversalAddress,
  toNative,
} from "@wormhole-foundation/sdk-definitions";
import { Wormhole } from "@wormhole-foundation/connect-sdk";
import { EvmAddress, EvmPlatform } from "@wormhole-foundation/connect-sdk-evm";

const processName = "configureSwapLayer";
init();
const chains = getOperatingChains();

async function run() {
  console.log(`Start ${processName}!`);

  for (const chain of chains) {
    console.log(`Updating configuration for chain ${chain.chainId}...`);

    const swapLayer = getSwapLayer(chain);
    const commands = createSwapLayerConfiguration(chain);
    const encodedCommands = encodeGovernanceCommandsBatch(commands);
    try {
      await swapLayer.batchGovernanceCommands(encodedCommands);
    } catch (e) {
      console.error(e);
      console.log("Failed to update configuration for chain " + chain.chainId);
      process.exit(1);
    }
  }
}

function createSwapLayerConfiguration(
  operatingChain: ChainInfo
): GovernanceCommand[] {
  const configurationOptions = loadSwapLayerConfiguration();
  const feeConfig = loadFeeConfig();
  const allChains = loadChains();
  const output: GovernanceCommand[] = [];

  if (configurationOptions.shouldRegisterEndpoints) {
    for (const currentChain of allChains) {
      if (operatingChain.chainId == currentChain.chainId) {
        continue; //don't register the same chain on itself
      }

      const swapLayerAddress = getSwapLayerAddress(operatingChain);
      const universalShim = toNative("Evm", swapLayerAddress).toUniversalAddress();

      const feeParams = feeConfig.find((config) => config.chainId == currentChain.chainId);
      if (!feeParams)
        throw new Error("No fee config found for chain " + currentChain.chainId);

      console.log(
        "Creating registration for chain:", currentChain.chainName,
        "with address:", swapLayerAddress,
        "and fee params:", feeParams,
      );

      //TODO why can't the linter deduce the types inside GovernanceCommand?

      //NOTE: we should detect whether this is an initial registration or an update, because this will eventually be required for update. Not important for now.
      //NOTE: the linter couldn't interpret the type of GovernanceCommand.
      //It said it was non-compliant until i explicitly declared it.
      const registerCommand: GovernanceCommand = {
        GovernanceCommand: "UpdateEndpoint",
        endpoint: {
          chain: currentChain.chainName,
          address: universalShim,
        },
        ...feeParams,
      };

      output.push(registerCommand);
    }
  }
  // if (configurationOptions.shouldUpdateAssistant) {
  //   //TODO pack update assistant command w/ newAssistantAddress
  // }
  // if (configurationOptions.shouldSweepTokens) {
  //   //TODO pack sweep tokens command
  // }
  // if (configurationOptions.shouldUpdateFeeRecipient) {
  //   //TODO pack update fee recipient command w/ newFeeRecipient
  // }

  return output;
}

run().then(() => console.log("Done!"));
