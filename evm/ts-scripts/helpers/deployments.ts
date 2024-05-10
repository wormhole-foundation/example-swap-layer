import { ChainInfo, Deployment, getChain, getSigner } from "./env";
import { ethers } from "ethers";
import { Create2Factory__factory } from "../../ethers-contracts-external/Create2Factory.sol/Create2Factory__factory";
import { SwapLayer__factory } from "../../ethers-contracts";
import { Proxy__factory } from "../../ethers-contracts";
import { encodeProxyConstructorArgs } from "@xlabs/wh-swap-layer-ts-sdk";

export const setupContractSalt = Buffer.from("0xSetup");
export const proxyContractSalt = Buffer.from("0xGenericRelayer");

export async function deploySwapLayerImplementation(
  chain: ChainInfo
): Promise<Deployment> {
  console.log("deploySwapLayerImplementation " + chain.chainId);
  const signer = getSigner(chain);

  const contractInterface = SwapLayer__factory.createInterface();
  const bytecode = SwapLayer__factory.bytecode;
  //@ts-ignore
  const factory = new ethers.ContractFactory(
    contractInterface,
    bytecode,
    signer
  );

  console.log(
    "contracts:" +
      "\nwethAddress: " +
      chain.wethAddress +
      "\npermit2: " +
      chain.permit2Address +
      "\nuniversalRouterAddress: " +
      chain.universalRouterAddress +
      "\nliquidityLayerAddress: " +
      chain.liquidityLayerAddress
  );

  //TODO use the ones off the ts-sdk instead

  //Note, you have to compile differently dependent on if you are using trader joe's or not.

  const contract = await factory.deploy(
    chain.liquidityLayerAddress,
    chain.permit2Address,
    chain.wethAddress,
    chain.universalRouterAddress,
    chain.traderJoeRouterAddress
  );
  return await contract.deployed().then((result) => {
    console.log("Successfully deployed contract at " + result.address);
    return { address: result.address, chainId: chain.chainId };
  });
}

export async function deploySwapLayerProxy(
  chain: ChainInfo,
  SwapLayerImplementationAddress: string
): Promise<Deployment> {
  console.log("deploySwapLayerProxy " + chain.chainId);

  const signer = getSigner(chain);
  const signerAddress = await signer.getAddress();
  const contractInterface = Proxy__factory.createInterface();
  const bytecode = Proxy__factory.bytecode;
  //@ts-ignore
  const factory = new ethers.ContractFactory(
    contractInterface,
    bytecode,
    signer
  );

  const swapLayerProxyConstructorParams = encodeProxyConstructorArgs({
    owner: signerAddress,
    assistant: signerAddress,
    feeUpdater: signerAddress,
    feeRecipient: signerAddress,
  });

  //TODO if using create2 factory that uses OpenZeppelin's proxy, be sure to include the call
  //  signature "checkedUpgrade(bytes)" like so:
  //const swapLayerInterface = SwapLayer__factory.createInterface();
  //swapLayerInterface.encodeFunctionData("checkedUpgrade", [swapLayerProxyConstructorParams]);

  const contract = await factory.deploy(
    SwapLayerImplementationAddress,
    swapLayerProxyConstructorParams,
    {
      gasLimit: 10000000,
    }
  );
  return await contract.deployed().then((result) => {
    console.log("Successfully deployed contract at " + result.address);
    return { address: result.address, chainId: chain.chainId };
  });
}

export async function deployCreate2Factory(
  chain: ChainInfo
): Promise<Deployment> {
  console.log("deployCreate2Factory " + chain.chainId);

  const result = await new Create2Factory__factory(getSigner(chain))
    .deploy()
    .then(deployed);
  console.log(`Successfully deployed contract at ${result.address}`);
  return { address: result.address, chainId: chain.chainId };
}

const deployed = (x: ethers.Contract) => x.deployed();
