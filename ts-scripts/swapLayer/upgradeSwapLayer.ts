//This file is intended to deploy the SwapLayer and do a proxy upgrade from an existing deployment.

import {
  init,
  writeOutputFiles,
  ChainInfo,
  Deployment,
  getSwapLayer,
  getOperatingChains,
} from "../helpers/env";
import { deploySwapLayerImplementation } from "../helpers/deployments";

const processName = "upgradeSwapLayer";
init();
const chains = getOperatingChains();

async function run() {
  console.log("Start!");
  const output: any = {
    SwapLayerImplementations: [],
  };

  for (let i = 0; i < chains.length; i++) {
    const SwapLayerImplementation = await deploySwapLayerImplementation(
      chains[i]
    );
    await upgradeSwapLayer(chains[i], SwapLayerImplementation);

    output.SwapLayerImplementations.push(SwapLayerImplementation);
  }

  writeOutputFiles(output, processName);
}

async function upgradeSwapLayer(chain: ChainInfo, newImpl: Deployment) {
  console.log("About to upgrade SwapLayer for chain " + chain.chainId);
  const provider = getSwapLayer(chain);
  const tx = await provider.upgrade(newImpl.address); //Note, the upgrade function signature on the SwapLayer contract is different from the DeliveryProvider contract.
  await tx.wait();
  console.log("Successfully upgraded contract " + chain.chainId);
}

run().then(() => console.log("Done!"));
