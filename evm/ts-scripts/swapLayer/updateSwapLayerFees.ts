import { FeeParamUpdate, encodeFeeParamUpdatesBatch } from "../../ts-sdk";
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
  loadFeeConfig,
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
    console.log(`Updating fee information for chain ${chain.chainId}...`);

    const swapLayer = getSwapLayer(chain);
    const updateObj = createBatchFeeUpdate(chain);
    const encodedCommands = encodeFeeParamUpdatesBatch(updateObj);
    try {
      await swapLayer.batchFeeUpdates(encodedCommands);
    } catch (e) {
      console.error(e);
      console.log("Failed to update fees for chain " + chain.chainId);
      process.exit(1);
    }
  }
}

function createBatchFeeUpdate(operatingChain: ChainInfo): FeeParamUpdate[] {
  const configurationOptions = loadFeeConfig();
  const allChains = loadChains();
  const output: FeeParamUpdate[] = [];

  for (const currentChain of allChains) {
    if (operatingChain.chainId == currentChain.chainId) {
      continue; //don't register the same chain on itself
    }
    const currentConfig = configurationOptions.find(
      (config) => config.chainId == currentChain.chainId
    );
    if (!currentConfig) {
      throw new Error(
        "No configuration found for chain " + currentChain.chainId
      );
    }

    const gasPriceUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "GasPrice",
        value: {
          gasPriceTimestamp: currentConfig.gasPriceTimestamp,
          gasPrice: currentConfig.gasPrice,
        },
      },
    };
    const gasTokenPriceUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "GasTokenPrice",
        value: currentConfig.gasTokenPrice,
      },
    };
    const baseFeeUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "BaseFee",
        value: currentConfig.baseFee,
      },
    };
    const gasPriceUpdateThresholdUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "GasPriceUpdateThreshold",
        value: currentConfig.gasPriceUpdateThreshold,
      },
    };
    const gasPriceMarginUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "GasPriceMargin",
        value: currentConfig.gasPriceMargin,
      },
    };
    const gasPriceDropoffMarginUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "GasDropoffMargin",
        value: currentConfig.gasDropoffMargin,
      },
    };
    const maxGasDropoffUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "MaxGasDropoff",
        value: currentConfig.maxGasDropoff,
      },
    };

    output.push(gasPriceUpdate);
    output.push(gasTokenPriceUpdate);
    output.push(baseFeeUpdate);
    output.push(gasPriceUpdateThresholdUpdate);
    output.push(gasPriceMarginUpdate);
    output.push(gasPriceDropoffMarginUpdate);
    output.push(maxGasDropoffUpdate);

    //console.log("FeeUpdates:", currentChain.chainName, output);
  }

  return output;
}

run().then(() => console.log("Done!"));
