import {
  deploySwapLayerImplementation,
  deploySwapLayerProxy,
} from "../helpers/deployments";
import {
  ChainInfo,
  getOperatingChains,
  getSwapLayer,
  init,
  loadChains,
  loadPrivateKey,
  loadSwapLayerConfiguration,
  writeOutputFiles,
} from "../helpers/env";

const processName = "updateSwapLayerFees";
init();
const chains = getOperatingChains();

async function run() {
  console.log(`Start ${processName}!`);

  for (const chain of chains) {
    console.log(`Updating configuration for chain ${chain.chainId}...`);

    const swapLayer = getSwapLayer(chain);
    //TODO call createSwapLayerConfiguration, serialize it using typecript SDK, and then call executeGovernanceActions with that object
    //swapLayer.executeGovernanceActions(null)
  }
}

//TODO output governance object from typescript sdk
function createSwapLayerConfiguration(chain: ChainInfo): any {
  const configurationOptions = loadSwapLayerConfiguration();
  const allChains = loadChains();
  const output: any = {};

  if (configurationOptions.shouldRegisterEndpoints) {
    //TODO pack these into the output object
  }
  if (configurationOptions.shouldUpdateAssistant) {
    //TODO pack update assistant command w/ newAssistantAddress
  }
  if (configurationOptions.shouldSweepTokens) {
    //TODO pack sweep tokens command
  }
  if (configurationOptions.shouldUpdateFeeRecipient) {
    //TODO pack update fee recipient command w/ newFeeRecipient
  }
}

run().then(() => console.log("Done!"));
