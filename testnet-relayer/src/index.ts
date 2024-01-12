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
import {
  Proxy__factory,
  SwapLayer,
  SwapLayer__factory,
  Proxy,
} from "../../ethers-contracts";
import {
  MessageDecoder,
  LiquidityLayerMessageBody,
} from "wormhole-liquidity-layer-sdk";
import { deserializeSwapMessage } from "@xlabs/wh-swap-layer-ts-sdk";
import { get } from "lodash";

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
  (async () => {
    try {
      // create payload buffer
      const payloadArray = Buffer.from(ethers.utils.arrayify(payload));

      const llMessage: LiquidityLayerMessageBody =
        MessageDecoder.decode(payloadArray);

      // if this isn't from a swap layer contract, then simply continue
      if (!isFromSwapLayer(llMessage)) {
        console.log("Not from swap layer, ignoring event");
        return;
      }

      const payloadFromLL: Buffer = getPayload(llMessage);

      //If it is, parse the payload for a swap layer message
      const parsedSwapLayerMessage = deserializeSwapMessage(payloadFromLL);

      // if the delivery type is not relay, then just continue
      if (parsedSwapLayerMessage.redeemMode.mode !== "Relay") {
        console.log("Not relay delivery type, ignoring event");
        return;
      }

      let fromChain: SupportedChainId = getFromChain(llMessage);

      console.log("Fetching receipt");
      const receipt = await typedEvent.getTransactionReceipt();

      console.log("Fetching Circle attestation");
      const [circleBridgeMessage, circleAttestation] =
        await handleCircleMessageInLogs(
          receipt.logs,
          getChainInfo(environment, fromChain).circleMessageTransmitter
        );
      if (circleBridgeMessage === null || circleAttestation === null) {
        throw new Error(
          `Error parsing receipt, txhash: ${typedEvent.transactionHash}`
        );
      }
      console.log("Fetching Wormhole message");
      const { vaaBytes } = await getSignedVAAWithRetry(
        environment.guardianRpcs,
        fromChain,
        getChainInfo(environment, fromChain).liquidityLayerAddress,
        sequence.toString()
      );

      const toChain = getToChain(circleBridgeMessage);

      console.log(
        "Successfully retrieved VAA, Circle Message, and Circle Attestion. Submitting redeem transaction..."
      );

      console.log(
        `Processing transaction from ${coalesceChainName(
          fromChain
        )} to ${coalesceChainName(toChain)}`
      );

      // create target contract instance
      const contract = SwapLayer__factory.connect(
        getChainInfo(environment, toChain).swapLayerAddress,
        getChainInfo(environment, toChain).signer
      );

      // redeem the transfer on the target chain
      const tx: ethers.ContractTransaction = await contract.redeem([], {
        encodedWormholeMessage: vaaBytes,
        circleBridgeMessage: circleBridgeMessage,
        circleAttestation: circleAttestation,
      });
      const redeedReceipt: ethers.ContractReceipt = await tx.wait();

      console.log(
        `Redeemed transfer in txhash: ${redeedReceipt.transactionHash}`
      );
    } catch (e) {
      console.error(e);
    }
  })();
}

function isFromSwapLayer(llMessage: LiquidityLayerMessageBody): boolean {
  const isFill = !!llMessage.fill;
  if (!isFill) {
    return false;
  }
  const sourceSender = llMessage.fill?.orderSender;
  const sourceChain = llMessage.fill?.sourceChain;
  if (!sourceSender || !sourceChain) {
    console.log(
      "No source sender or source chain found in liquidity layer message body"
    );
    return false;
  }
  if (
    tryUint8ArrayToNative(sourceSender, "ethereum").toLowerCase() ==
    getChainInfo(environment, sourceChain as any).swapLayerAddress.toLowerCase()
  ) {
    return true;
  } else {
    return false;
  }
}

function getFromChain(llMessage: LiquidityLayerMessageBody): SupportedChainId {
  if (!llMessage.fill?.sourceChain) {
    throw new Error("No source chain found in liquidity layer message body");
  }
  return llMessage.fill?.sourceChain as SupportedChainId;
}

function getToChain(circleMessage: string): SupportedChainId {
  const toDomain = new Buffer(circleMessage, "hex").readUInt32BE(69);
  //from all chains, find the one with this domain
  const toChain = SUPPORTED_CHAINS.find((chain) => {
    return getChainInfo(environment, chain).circleDomain == toDomain;
  });
  return toChain as SupportedChainId;
}

function getPayload(llMessage: LiquidityLayerMessageBody): Buffer {
  if (!llMessage.fill?.redeemerMessage) {
    throw new Error(
      "No redeemer message found in liquidity layer message body"
    );
  }
  return llMessage.fill?.redeemerMessage;
}

function subscribeToEvents(
  wormhole: ethers.Contract,
  chainId: SupportedChainId
) {
  const chainName = coalesceChainName(chainId);
  const coreContract = CONTRACTS.TESTNET[chainName].core;
  const sender = getChainInfo(environment, chainId).liquidityLayerAddress;
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
