import {
  CHAIN_ID_AVAX,
  CHAIN_ID_ETH,
  coalesceChainName,
  CONTRACTS,
  getEmitterAddressEth,
  getSignedVAAWithRetry,
  uint8ArrayToHex,
  tryUint8ArrayToNative,
  tryHexToNativeAssetString,
} from "@certusone/wormhole-sdk";
import { Implementation__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { TypedEvent } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts/commons";
import { AxiosResponse } from "axios";
import { Contract, ethers, Wallet } from "ethers";
import { WebSocketProvider } from "./websocket";
import { createEnvironment, getChainInfo } from "./env";
const axios = require("axios"); // import breaks

const environment = createEnvironment();

// supported chains
const SUPPORTED_CHAINS = environment.chains.map((chain) => chain.chainId);
type SupportedChainId = (typeof SUPPORTED_CHAINS)[number];

function findCircleMessageInLogs(
  logs: ethers.providers.Log[],
  circleEmitterAddress: string
): string | null {
  for (const log of logs) {
    if (log.address === circleEmitterAddress) {
      const messageSentIface = new ethers.utils.Interface([
        "event MessageSent(bytes message)",
      ]);
      return messageSentIface.parseLog(log).args.message as string;
    }
  }

  return null;
}

async function sleep(timeout: number) {
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

async function getCircleAttestation(
  messageHash: ethers.BytesLike,
  timeout: number = 2000
) {
  while (true) {
    // get the post
    const response = await axios
      .get(`https://iris-api-sandbox.circle.com/attestations/${messageHash}`)
      .catch(() => {
        return null;
      })
      .then(async (response: AxiosResponse | null) => {
        if (
          response !== null &&
          response.status === 200 &&
          response.data.status === "complete"
        ) {
          return response.data.attestation as string;
        }

        return null;
      });

    if (response !== null) {
      return response;
    }

    await sleep(timeout);
  }
}

async function handleCircleMessageInLogs(
  logs: ethers.providers.Log[],
  circleEmitterAddress: string
): Promise<[string | null, string | null]> {
  const circleMessage = findCircleMessageInLogs(logs, circleEmitterAddress);
  if (circleMessage === null) {
    return [null, null];
  }

  const circleMessageHash = ethers.utils.keccak256(circleMessage);
  const signature = await getCircleAttestation(circleMessageHash);

  return [circleMessage, signature];
}

function handleRelayerEvent(
  _sender: string,
  sequence: ethers.BigNumber,
  _nonce: number,
  payload: string,
  _consistencyLevel: number,
  typedEvent: TypedEvent<
    [string, ethers.BigNumber, number, string, number] & {
      sender: string;
      sequence: ethers.BigNumber;
      nonce: number;
      payload: string;
      consistencyLevel: number;
    }
  >
) {
  console.log(`Parsing transaction: ${typedEvent.transactionHash}`);
  //TODO this

  // (async () => {
  //   try {
  //     // create payload buffer
  //     const payloadArray = Buffer.from(ethers.utils.arrayify(payload));

  //     // parse fromDomain
  //     const fromDomain = payloadArray.readUInt32BE(65);
  //     if (!(fromDomain in CIRCLE_DOMAIN_TO_WORMHOLE_CHAIN)) {
  //       console.warn(`Unknown fromDomain: ${fromDomain}`);
  //       return;
  //     }

  //     // cache fromChain ID
  //     const fromChain = CIRCLE_DOMAIN_TO_WORMHOLE_CHAIN[fromDomain];

  //     // parse toDomain
  //     const toDomain = payloadArray.readUInt32BE(69);
  //     if (!(toDomain in CIRCLE_DOMAIN_TO_WORMHOLE_CHAIN)) {
  //       console.warn(`Unknown toDomain: ${toDomain}`);
  //     }

  //     // cache toChain ID
  //     const toChain = CIRCLE_DOMAIN_TO_WORMHOLE_CHAIN[toDomain];

  //     // parse mintRecipient
  //     const mintRecipient = tryUint8ArrayToNative(
  //       payloadArray.subarray(81, 113),
  //       toChain
  //     );

  //     if (
  //       ethers.utils.getAddress(mintRecipient) !=
  //       ethers.utils.getAddress(USDC_RELAYER[fromChain])
  //     ) {
  //       console.warn(
  //         `Unknown mintRecipient: ${mintRecipient} for chainId: ${toChain}, terminating relay`
  //       );
  //       return;
  //     }
  //     console.log(
  //       `Processing transaction from ${coalesceChainName(
  //         fromChain
  //       )} to ${coalesceChainName(toChain)}`
  //     );
  //     console.log("Fetching receipt");
  //     const receipt = await typedEvent.getTransactionReceipt();

  //     console.log("Fetching Circle attestation");
  //     const [circleBridgeMessage, circleAttestation] =
  //       await handleCircleMessageInLogs(
  //         receipt.logs,
  //         CIRCLE_EMITTER_ADDRESSES[fromChain]
  //       );
  //     if (circleBridgeMessage === null || circleAttestation === null) {
  //       throw new Error(
  //         `Error parsing receipt, txhash: ${typedEvent.transactionHash}`
  //       );
  //     }
  //     console.log("Fetching Wormhole message");
  //     const { vaaBytes } = await getSignedVAAWithRetry(
  //       WORMHOLE_RPC_HOSTS,
  //       fromChain,
  //       USDC_WH_EMITTER[fromChain],
  //       sequence.toString()
  //     );

  //     // redeem parameters for target function call
  //     const redeemParameters = [
  //       `0x${uint8ArrayToHex(vaaBytes)}`,
  //       circleBridgeMessage,
  //       circleAttestation,
  //     ];
  //     console.log("All redeem parameters have been located");

  //     // create target contract instance
  //     const contract = relayerContract(USDC_RELAYER[toChain], SIGNERS[toChain]);

  //     // Find the address of the encoded token on the target chain. The address
  //     // that is encoded in the payload is the address on the source chain.
  //     console.log("Fetching token address from target chain.");
  //     const targetTokenAddress = await integrationContract(
  //       USDC_WH_SENDER[toChain],
  //       SIGNERS[toChain]
  //     ).fetchLocalTokenAddress(
  //       fromDomain,
  //       payloadArray.subarray(1, 33) // encoded token address
  //     );

  //     // parse the toNativeTokenAmount
  //     const toNativeAmount = ethers.utils.hexlify(
  //       payloadArray.subarray(180, 212)
  //     );

  //     // query for native amount to swap with contract
  //     const nativeSwapQuote = await contract.calculateNativeSwapAmountOut(
  //       tryUint8ArrayToNative(
  //         ethers.utils.arrayify(targetTokenAddress),
  //         toChain
  //       ),
  //       toNativeAmount
  //     );
  //     console.log(
  //       `Native amount to swap with contract: ${ethers.utils.formatEther(
  //         nativeSwapQuote
  //       )}`
  //     );

  //     // redeem the transfer on the target chain
  //     const tx: ethers.ContractTransaction = await contract.redeemTokens(
  //       redeemParameters,
  //       {
  //         value: nativeSwapQuote,
  //       }
  //     );
  //     const redeedReceipt: ethers.ContractReceipt = await tx.wait();

  //     console.log(
  //       `Redeemed transfer in txhash: ${redeedReceipt.transactionHash}`
  //     );
  //   } catch (e) {
  //     console.error(e);
  //   }
  // })();
}

function subscribeToEvents(
  wormhole: ethers.Contract,
  chainId: SupportedChainId
) {
  const chainName = coalesceChainName(chainId);
  const coreContract = CONTRACTS.TESTNET[chainName].core;
  const sender = getChainInfo(environment, chainId).swapLayerAddress;
  if (!coreContract) {
    console.error("No known core contract for chain", chainName);
    process.exit(1);
  }

  // unsubscribe and resubscribe to reset websocket connection
  wormhole.off(
    wormhole.filters.LogMessagePublished(sender),
    handleRelayerEvent
  );
  wormhole.on(wormhole.filters.LogMessagePublished(sender), handleRelayerEvent);
  console.log(`Subscribed to: ${chainName}, core contract: ${coreContract}`);
}

async function main(sleepMs: number) {
  let run = true;
  while (run) {
    // resubscribe to contract events every 5 minutes
    for (const chainId of SUPPORTED_CHAINS) {
      try {
        subscribeToEvents(
          getChainInfo(environment, chainId).wormholeContract,
          chainId
        );
      } catch (e: any) {
        console.log(e);
        run = false;
      }
    }
    await sleep(sleepMs);
  }
}

// start the process
main(300000);
