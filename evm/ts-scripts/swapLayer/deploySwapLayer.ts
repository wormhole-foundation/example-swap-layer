import {
  deploySwapLayerImplementation,
  deploySwapLayerProxy,
} from "../helpers/deployments";
import {
  getOperatingChains,
  init,
  loadPrivateKey,
  writeOutputFiles,
} from "../helpers/env";

const processName = "deploySwapLayer";
init();
const chains = getOperatingChains();

async function run() {
  console.log(`Start ${processName}!`);
  const output: any = {
    SwapLayerImplementations: [],
    SwapLayerSetups: [],
    SwapLayerProxies: [],
  };

  for (const chain of chains) {
    console.log(`Deploying for chain ${chain.chainId}...`);
    console.log("Deploying SwapLayerImplementation");
    const SwapLayerImplementation = await deploySwapLayerImplementation(chain);
    console.log("Deploying SwapLayerProxy");
    const SwapLayerProxy = await deploySwapLayerProxy(
      chain,
      SwapLayerImplementation.address
    );
    output.SwapLayerImplementations.push(SwapLayerImplementation);
    output.SwapLayerProxies.push(SwapLayerProxy);
    console.log("");
  }

  writeOutputFiles(output, processName);
}

run().then(() => console.log("Done!"));
