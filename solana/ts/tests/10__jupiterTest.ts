import * as anchor from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import * as wormholeSdk from "@certusone/wormhole-sdk";
import {
    AddressLookupTableProgram,
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    ComputeBudgetProgram,
} from "@solana/web3.js";
import { expectIxOk, hackedExpectDeepEqual } from "./helpers";
import { FEE_UPDATER_KEYPAIR } from "./helpers";
import { SwapLayerProgram, localnet, Custodian } from "../src/swapLayer";
import { use as chaiUse, expect } from "chai";
import * as tokenRouterSdk from "../../../lib/example-liquidity-layer/solana/ts/src/tokenRouter";
import {
    LiquidityLayerDeposit,
    LiquidityLayerMessage,
} from "../../../lib/example-liquidity-layer/solana/ts/src/common";
import {
    postLiquidityLayerVaa,
    LOCALHOST,
    PAYER_KEYPAIR,
    OWNER_KEYPAIR,
    OWNER_ASSISTANT_KEYPAIR,
    USDC_MINT_ADDRESS,
    ETHEREUM_USDC_ADDRESS,
    MOCK_GUARDIANS,
    CircleAttester,
} from "../../../lib/example-liquidity-layer/solana/ts/tests/helpers";
import { VaaAccount } from "../../../lib/example-liquidity-layer/solana/ts/src/wormhole";
import { CctpTokenBurnMessage } from "../../../lib/example-liquidity-layer/solana/ts/src/cctp";

chaiUse(require("chai-as-promised"));

describe("Jupiter V6 Testing", () => {
    const connection = new Connection(LOCALHOST, "processed");
    const payer = PAYER_KEYPAIR;
    const relayer = Keypair.generate();
    const owner = OWNER_KEYPAIR;
    const recipient = Keypair.generate();
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;
    const feeUpdater = FEE_UPDATER_KEYPAIR;
    const feeRecipient = Keypair.generate();
    const feeRecipientToken = splToken.getAssociatedTokenAddressSync(
        USDC_MINT_ADDRESS,
        feeRecipient.publicKey,
    );

    // Sending chain information.
    const foreignChain = wormholeSdk.CHAINS.sepolia;
    const foreignEndpointAddress = Array.from(
        Buffer.alloc(32, "000000000000000000000000603541d1Cf7178C407aA7369b67CB7e0274952e2", "hex"),
    );
    const foreignCctpDomain = 0;

    // Program SDKs
    const swapLayer = new SwapLayerProgram(connection, localnet(), USDC_MINT_ADDRESS);
    const tokenRouter = new tokenRouterSdk.TokenRouterProgram(
        connection,
        tokenRouterSdk.testnet(),
        USDC_MINT_ADDRESS,
    );

    let tokenRouterLkupTable: PublicKey;

    describe("Whirlpool", () => {
        // TODO
    });
});

const jupiterV6SwapIxResponseWhirlpool = {
    computeBudgetInstructions: [
        {
            programId: "ComputeBudget111111111111111111111111111111",
            accounts: [],
            data: "AsBcFQA=",
        },
        {
            programId: "ComputeBudget111111111111111111111111111111",
            accounts: [],
            data: "AwQXAQAAAAAA",
        },
    ],
    setupInstructions: [
        {
            programId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
            accounts: [
                {
                    pubkey: "21TrZtZnFU1rEvmiKTNSdZz7voe8kRZL7KX3pEGe7rS2",
                    isSigner: true,
                    isWritable: true,
                },
                {
                    pubkey: "CyBqVej3Bq73UGdaYv2BMNLeRhfv2nkUSy2KA4Tc5WtE",
                    isSigner: false,
                    isWritable: true,
                },
                {
                    pubkey: "21TrZtZnFU1rEvmiKTNSdZz7voe8kRZL7KX3pEGe7rS2",
                    isSigner: false,
                    isWritable: false,
                },
                {
                    pubkey: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                    isSigner: false,
                    isWritable: false,
                },
                {
                    pubkey: "11111111111111111111111111111111",
                    isSigner: false,
                    isWritable: false,
                },
                {
                    pubkey: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                    isSigner: false,
                    isWritable: false,
                },
            ],
            data: "AQ==",
        },
    ],
    swapInstruction: {
        programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
        accounts: [
            {
                pubkey: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "CapuXNQoDviLvU1PxFiizLgPNQCxrsag1uMeyk6zLVps",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "21TrZtZnFU1rEvmiKTNSdZz7voe8kRZL7KX3pEGe7rS2",
                isSigner: true,
                isWritable: false,
            },
            {
                pubkey: "BGNHoqiqB4oM7caZvDUKqC2JMfjXA8MnxeeaGrHdJ5xP",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "GQuvMWcBF1M2wgh2sbxkonq7FtBc6UNurtHjREMRAL1x",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "Gjmjory7TWKJXD2Jc6hKzAG991wWutFhtbXudzJqgx3p",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "CyBqVej3Bq73UGdaYv2BMNLeRhfv2nkUSy2KA4Tc5WtE",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "CapuXNQoDviLvU1PxFiizLgPNQCxrsag1uMeyk6zLVps",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "Gjmjory7TWKJXD2Jc6hKzAG991wWutFhtbXudzJqgx3p",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "4oY1eVHJrt7ywuFoQnAZwto4qcQip1QhYMAhD11PU4QL",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "GQuvMWcBF1M2wgh2sbxkonq7FtBc6UNurtHjREMRAL1x",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "4dSG9tKHZR4CAictyEnH9XuGZyKapodWXq5xyg7uFwE9",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "8kZSTVuV7C4GD9ZVR4wDtRSXv1SvsSQPfqUbthueRNGV",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "FqFkv2xNNCUyx1RYV61pGZ9AMzGfgcD8uXC9zCF5JKnR",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "A7sdy3NoAZp49cQNpreMGARAb9QJjYrrSyDALhThgk3D",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "3NxDBWt55DZnEwwQ2bhQ3xWG8Jd18TdUXAG4Zdr7jDai",
                isSigner: false,
                isWritable: false,
            },
        ],
        data: "wSCbM0HWnIEFAQAAABEAZAABAHQ7pAsAAACpMkamCwAAADIAAA==",
    },
    addressLookupTableAddresses: ["GxS6FiQ3mNnAar9HGQ6mxP7t6FcwmHkU7peSeQDUHmpN"],
} as const;
