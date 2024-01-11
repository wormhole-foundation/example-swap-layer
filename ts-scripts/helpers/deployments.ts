import { ChainInfo, Deployment, getChain, getSigner } from "./env";
import { ethers } from "ethers";
import { Create2Factory__factory } from "../../ethers-contracts-external/Create2Factory.sol/Create2Factory__factory";
import { SwapLayer__factory } from "../../ethers-contracts";
import { Proxy__factory } from "../../ethers-contracts";

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

  const contract = await factory.deploy(
    chain.permit2Address,
    chain.uniswapV3RouterAddress,
    chain.liquidityLayerAddress
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

  // let ABI = ["function setup(address)"];
  // let iface = new ethers.utils.Interface(ABI);
  // let encodedData = iface.encodeFunctionData("setup", [
  //   SwapLayerImplementationAddress,
  // ]);

  //TODO use the typescript SDK to do this and accept the additional parameters
  const abi = ethers.utils.defaultAbiCoder;
  const params = abi.encode(
    ["address", "address", "address"], // encode as address array
    [signerAddress, signerAddress, signerAddress]
  );

  const contract = await factory.deploy(SwapLayerImplementationAddress, params);
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
