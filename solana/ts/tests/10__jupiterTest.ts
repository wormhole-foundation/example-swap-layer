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
    TransactionInstruction,
    AccountMeta,
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
    ETHEREUM_USDC_ADDRESS,
    MOCK_GUARDIANS,
    CircleAttester,
} from "../../../lib/example-liquidity-layer/solana/ts/tests/helpers";
import { VaaAccount } from "../../../lib/example-liquidity-layer/solana/ts/src/wormhole";
import { CctpTokenBurnMessage } from "../../../lib/example-liquidity-layer/solana/ts/src/cctp";
import * as jupiter from "../src/jupiter";
import { Whirlpool, IDL as WHIRLPOOL_IDL } from "../src/types/whirlpool";
import { IDL as SWAP_LAYER_IDL } from "../../target/types/swap_layer";

chaiUse(require("chai-as-promised"));

const SWAP_LAYER_PROGRAM_ID = new PublicKey("AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m");

const USDT_MINT_ADDRESS = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const USDC_MINT_ADDRESS = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const JUPITER_V6_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

const WHIRLPOOL_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const WHIRLPOOL_USDC_USDT = new PublicKey("4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4");

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

    const whirlpoolProgram = new anchor.Program(WHIRLPOOL_IDL, WHIRLPOOL_PROGRAM_ID, {
        connection,
    });

    const swapLayerProgram = new anchor.Program(SWAP_LAYER_IDL, SWAP_LAYER_PROGRAM_ID, {
        connection,
    });

    describe("Whirlpool", () => {
        it.skip("Swap USDT to USDC", async function () {
            const swapIx = jupiter.toTransactionInstruction(
                jupiterV6SwapIxResponseWhirlpool.swapInstruction,
            );

            const usdtToken = splToken.getAssociatedTokenAddressSync(
                USDT_MINT_ADDRESS,
                payer.publicKey,
            );
            const usdtTokenData = await splToken.getAccount(connection, usdtToken);
            console.log({ usdtTokenData });

            const usdcToken = splToken.getAssociatedTokenAddressSync(
                USDC_MINT_ADDRESS,
                payer.publicKey,
            );
            const usdcTokenData = await splToken.getAccount(connection, usdcToken);
            console.log({ usdcTokenData });

            const transferAuthority = jupiterTransferAuthorityAddress(2);
            const ix = jupiterV6SwapIx(
                {
                    user: payer.publicKey,
                    transferAuthority,
                    inputMint: USDT_MINT_ADDRESS,
                    outputMint: USDC_MINT_ADDRESS,
                },
                //swapIx.keys.slice(13),
                await whirlpoolIxSetup(
                    whirlpoolProgram,
                    { tokenAuthority: transferAuthority, whirlpool: WHIRLPOOL_USDC_USDT },
                    true,
                ),
                swapIx.data,
            );

            expect(swapIx.keys).has.length(ix.keys.length);

            const txSig = await expectIxOk(connection, [ix], [payer]);
        });
    });

    describe("Complete Swap Passthrough (WIP)", function () {
        // TODO

        it.skip("Swap USDT to USDC", async function () {
            const ixData = Buffer.from(
                "wSCbM0HWnIECAQAAABEAZAABAHQ7pAsAAAAoYEulCwAAADIAAA==",
                "base64",
            );
            const transferAuthority = jupiterTransferAuthorityAddress(2);
            const innerIx = jupiterV6SwapIx(
                {
                    user: payer.publicKey,
                    transferAuthority,
                    inputMint: USDT_MINT_ADDRESS,
                    outputMint: USDC_MINT_ADDRESS,
                },
                //swapIx.keys.slice(13),
                await whirlpoolIxSetup(
                    whirlpoolProgram,
                    { tokenAuthority: transferAuthority, whirlpool: WHIRLPOOL_USDC_USDT },
                    true,
                ),
                ixData,
            );

            const ix = await swapLayerProgram.methods
                .completeSwap(ixData)
                .accounts({
                    srcToken: splToken.getAssociatedTokenAddressSync(
                        USDT_MINT_ADDRESS,
                        payer.publicKey,
                    ),
                })
                .remainingAccounts(innerIx.keys)
                .instruction();

            const txSig = await expectIxOk(connection, [ix], [payer]);
        });
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
                pubkey: "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV",
                isSigner: false,
                isWritable: false,
            },
            {
                //pubkey: "21TrZtZnFU1rEvmiKTNSdZz7voe8kRZL7KX3pEGe7rS2",
                pubkey: "pFCBP4bhqdSsrWUVTgqhPsLrfEdChBK17vgFM7TxjxQ",
                isSigner: true,
                isWritable: false,
            },
            {
                //pubkey: "BGNHoqiqB4oM7caZvDUKqC2JMfjXA8MnxeeaGrHdJ5xP",
                pubkey: "4MXG73DEVVRN9xiJavCkFVFtZdYBrKmD1hjxmTtNoZnA",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "6pXVFSACE5BND2C3ibGRWMG1fNtV7hfynWrfNKtCXhN3",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "7u7cD7NxcZEuzRCBaYo8uVpotRdqZwez47vvuwzCov43",
                isSigner: false,
                isWritable: true,
            },
            {
                //pubkey: "CyBqVej3Bq73UGdaYv2BMNLeRhfv2nkUSy2KA4Tc5WtE",
                pubkey: "4tKtuvtQ4TzkkrkESnRpbfSXCEZPkZe3eL5tCFUdpxtf",
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
                pubkey: "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV",
                isSigner: false,
                isWritable: false,
            },
            {
                pubkey: "4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "7u7cD7NxcZEuzRCBaYo8uVpotRdqZwez47vvuwzCov43",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "4oY1eVHJrt7ywuFoQnAZwto4qcQip1QhYMAhD11PU4QL",
                isSigner: false,
                isWritable: true,
            },
            {
                pubkey: "6pXVFSACE5BND2C3ibGRWMG1fNtV7hfynWrfNKtCXhN3",
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
        data: "wSCbM0HWnIECAQAAABEAZAABAHQ7pAsAAAAoYEulCwAAADIAAA==",
    },
    addressLookupTableAddresses: ["GxS6FiQ3mNnAar9HGQ6mxP7t6FcwmHkU7peSeQDUHmpN"],
};

function eventAuthorityAddress(programId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], programId)[0];
}

function jupiterTransferAuthorityAddress(authorityId: number) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("authority"), Buffer.from([authorityId])],
        JUPITER_V6_PROGRAM_ID,
    )[0];
}

async function whirlpoolIxSetup(
    whirlpoolProgram: anchor.Program<Whirlpool>,
    accounts: { tokenAuthority: PublicKey; whirlpool: PublicKey },
    aToB: boolean,
): Promise<AccountMeta[]> {
    const { tokenAuthority, whirlpool } = accounts;

    const { tokenMintA, tokenMintB, tokenVaultA, tokenVaultB } =
        await whirlpoolProgram.account.whirlpool.fetch(whirlpool);

    const { tickArray0, tickArray1, tickArray2 } = (() => {
        if (whirlpool.equals(WHIRLPOOL_USDC_USDT)) {
            const tickArray0 = new PublicKey("8kZSTVuV7C4GD9ZVR4wDtRSXv1SvsSQPfqUbthueRNGV");
            if (aToB) {
                return {
                    tickArray0,
                    tickArray1: new PublicKey("FqFkv2xNNCUyx1RYV61pGZ9AMzGfgcD8uXC9zCF5JKnR"),
                    tickArray2: new PublicKey("A7sdy3NoAZp49cQNpreMGARAb9QJjYrrSyDALhThgk3D"),
                };
            } else {
                return {
                    tickArray0,
                    tickArray1: new PublicKey("2B48L1ACPvVb67UKeSMkUGdzrnhvNMm6pFt2nspGKxs4"),
                    tickArray2: new PublicKey("BMGfBaW69aUm6hRdmsfAcNEmAW59C2rWJ9EX7gWnrVN9"),
                };
            }
        } else {
            throw new Error("Unrecognized whirlpool");
        }
    })();
    const swapAccounts = [
        {
            pubkey: splToken.TOKEN_PROGRAM_ID,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: tokenAuthority,
            isWritable: false,
            isSigner: false,
        },
        {
            pubkey: whirlpool,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: splToken.getAssociatedTokenAddressSync(
                tokenMintA,
                tokenAuthority,
                true, // allowOwnerOffCurve
            ),
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: tokenVaultA,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: splToken.getAssociatedTokenAddressSync(
                tokenMintB,
                tokenAuthority,
                true, // allowOwnerOffCurve
            ),
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: tokenVaultB,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: tickArray0,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: tickArray1,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: tickArray2,
            isWritable: true,
            isSigner: false,
        },
        {
            pubkey: PublicKey.findProgramAddressSync(
                [Buffer.from("oracle"), whirlpool.toBuffer()],
                whirlpoolProgram.programId,
            )[0],
            isWritable: false,
            isSigner: false,
        },
    ];

    return [{ pubkey: WHIRLPOOL_PROGRAM_ID, isWritable: false, isSigner: false }].concat(
        swapAccounts,
    );
}

function jupiterV6SwapIx(
    accounts: {
        user: PublicKey;
        transferAuthority: PublicKey;
        inputMint: PublicKey;
        outputMint: PublicKey;
        platformFee?: PublicKey;
    },
    composedDexAccountMetas: AccountMeta[],
    ixData: Buffer,
): TransactionInstruction {
    const { user, transferAuthority, inputMint, outputMint } = accounts;

    let { platformFee } = accounts;

    platformFee ??= JUPITER_V6_PROGRAM_ID;
    const platformFeeIsWritable = platformFee.equals(JUPITER_V6_PROGRAM_ID);

    const token2022Program = JUPITER_V6_PROGRAM_ID; // disables this option

    const sourceToken = splToken.getAssociatedTokenAddressSync(
        inputMint,
        user,
        //true, // allowOwnerOffCurve
    );
    const destinationToken = splToken.getAssociatedTokenAddressSync(
        outputMint,
        user,
        true, // allowOwnerOffCurve
    );

    const programSourceToken = splToken.getAssociatedTokenAddressSync(
        inputMint,
        transferAuthority,
        true, // allowOwnerOffCurve
    );
    const programDestinationToken = splToken.getAssociatedTokenAddressSync(
        outputMint,
        transferAuthority,
        true, // allowOwnerOffCurve
    );

    const eventAuthority = eventAuthorityAddress(JUPITER_V6_PROGRAM_ID);

    const jupiterV6Keys = [
        { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: transferAuthority, isSigner: false, isWritable: false },
        { pubkey: user, isSigner: true, isWritable: false },
        { pubkey: sourceToken, isSigner: false, isWritable: true },
        { pubkey: programSourceToken, isSigner: false, isWritable: true },
        { pubkey: programDestinationToken, isSigner: false, isWritable: true },
        { pubkey: destinationToken, isSigner: false, isWritable: true },
        { pubkey: inputMint, isSigner: false, isWritable: false },
        { pubkey: outputMint, isSigner: false, isWritable: false },
        { pubkey: platformFee, isSigner: false, isWritable: platformFeeIsWritable },
        { pubkey: token2022Program, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: JUPITER_V6_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    return {
        programId: JUPITER_V6_PROGRAM_ID,
        keys: jupiterV6Keys.concat(composedDexAccountMetas),
        data: ixData,
    };
}

// TODO: look into shared account swap w/ token ledger
const JUPITER_V6_TOKEN_LEDGERS = [
    new PublicKey("HtncvpUBGhSrs48KtC58ntJcTDw53sn78Lpq71zVwiez"),
    new PublicKey("HxTk98CmBcxmtkrBWqRszYxrnDpqAsbitQBc2QjVBG3j"),
    new PublicKey("CnUPHtfUVw3D2s4FB8H6QBuLwoes8YxauVgDtFybm7rz"),
    new PublicKey("FhLPkpFmszHtSyyayj7KsXNZeBTqfQbUPmvgWAyJHBXh"),
];
