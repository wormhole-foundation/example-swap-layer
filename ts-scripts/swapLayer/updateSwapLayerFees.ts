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
      await swapLayer.updateFeeParams(encodedCommands);
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
      continue; //TODO: decide if we want to register the same chain on itself.
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
          gasPriceTimestamp: parseInt(currentConfig.gasPriceTimestamp),
          gasPrice: BigInt(currentConfig.gasPrice),
        },
      },
    };
    const gasTokenPriceUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "GasTokenPrice",
        value: BigInt(currentConfig.gasTokenPrice),
      },
    };
    const baseFeeUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "BaseFee",
        value: BigInt(currentConfig.baseFee),
      },
    };
    const gasPriceUpdateThresholdUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "GasPriceUpdateThreshold",
        value: parseInt(currentConfig.gasPriceUpdateThreshold),
      },
    };
    const gasPriceMarginUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "GasPriceMargin",
        value: parseInt(currentConfig.gasPriceMargin),
      },
    };
    const gasPriceDropoffMarginUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "GasDropoffMargin",
        value: parseInt(currentConfig.gasDropoffMargin),
      },
    };
    const maxGasDropoffUpdate: FeeParamUpdate = {
      chain: currentChain.chainName,
      update: {
        param: "MaxGasDropoff",
        value: BigInt(currentConfig.maxGasDropoff),
      },
    };

    output.push(gasPriceUpdate);
    output.push(gasTokenPriceUpdate);
    output.push(baseFeeUpdate);
    output.push(gasPriceUpdateThresholdUpdate);
    output.push(gasPriceMarginUpdate);
    output.push(gasPriceDropoffMarginUpdate);
    output.push(maxGasDropoffUpdate);
  }

  return output;
}

run().then(() => console.log("Done!"));
