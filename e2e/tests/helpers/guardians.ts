import { ethers } from "ethers";
import { parseEvmEvents, parseEvmEvent } from "@wormhole-foundation/example-liquidity-layer-evm";
import { GUARDIAN_PRIVATE_KEY } from "./consts";
import { Chain, contracts, toChain } from "@wormhole-foundation/sdk-base";
import { VAA, serialize, toUniversal } from "@wormhole-foundation/sdk-definitions";
import { mocks } from "@wormhole-foundation/sdk-definitions/testing";
import { Connection, PublicKey } from "@solana/web3.js";
import { deserializePostMessage } from "@wormhole-foundation/sdk-solana-core";

export class GuardianNetwork {
    guardians: mocks.MockGuardians;

    constructor(guardianSetIndex: number) {
        this.guardians = new mocks.MockGuardians(guardianSetIndex, [GUARDIAN_PRIVATE_KEY]);
    }

    async observeSolana(connection: Connection, message: PublicKey) {
        const {
            emitterAddress,
            emitterChain,
            sequence,
            timestamp,
            nonce,
            consistencyLevel,
            payload,
        } = await connection
            .getAccountInfo(new PublicKey(message))
            .then((info) => deserializePostMessage(info?.data!));

        const foreignEmitter = new mocks.MockEmitter(
            emitterAddress,
            toChain(emitterChain),
            sequence,
        );

        const published = foreignEmitter.publishMessage(
            nonce,
            payload,
            consistencyLevel,
            timestamp,
        );

        return serialize(this.guardians.addSignatures(published, [0]));
    }

    async evmBody(
        message: ethers.utils.Result,
        provider: ethers.providers.Provider,
        chain: Chain,
        txReceipt: ethers.ContractReceipt,
    ) {
        const { sender: emitterAddress, sequence, nonce, payload, consistencyLevel } = message;

        const foreignEmitter = new mocks.MockEmitter(
            toUniversal(chain, emitterAddress),
            chain,
            sequence,
        );

        const block = await provider.getBlock(txReceipt.blockNumber);
        const published = foreignEmitter.publishMessage(
            nonce,
            Buffer.from(payload.substring(2), "hex"),
            consistencyLevel,
            block.timestamp,
        );

        return published;
    }

    async observeEvm(
        provider: ethers.providers.Provider,
        chain: Chain,
        txReceipt: ethers.ContractReceipt,
    ) {
        const coreBridgeAddress = contracts.coreBridge.get("Mainnet", chain)!;
        const message = parseEvmEvent(
            txReceipt,
            coreBridgeAddress,
            "LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)",
        );

        const body = await this.evmBody(message, provider, chain, txReceipt);
        return serialize(this.guardians.addSignatures(body, [0]));
    }

    async observeManyEvm(
        provider: ethers.providers.Provider,
        chain: Chain,
        txReceipt: ethers.ContractReceipt,
    ) {
        const coreBridgeAddress = contracts.coreBridge.get("Mainnet", chain)!;
        const messages = parseEvmEvents(
            txReceipt,
            coreBridgeAddress,
            "LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)",
        );

        const signedMessages: VAA[] = [];

        for (const message of messages) {
            const body = await this.evmBody(message, provider, chain, txReceipt);
            signedMessages.push(this.guardians.addSignatures(body, [0]));
        }

        return signedMessages.map((vaa) => serialize(vaa));
    }
}
