import { InstructionFromJSON, createJupiterApiClient } from "@jup-ag/api";
import * as splToken from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { execSync } from "child_process";

const USDC_MINT_ADDRESS = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDT_MINT_ADDRESS = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

const ALLOWED_DEXES = [
    //"Lifinity V2", // use
    //"Meteora DLMM", // use
    //"Orca V2",
    //"Phoenix", // use
    //"Raydium",
    //"Raydium CLMM", // use
    "Whirlpool", // use
];

main();

async function main() {
    const jupiter = createJupiterApiClient({
        basePath: "https://quote-api.jup.ag/v6",
    });

    const inputMint = USDT_MINT_ADDRESS;
    const outputMint = USDC_MINT_ADDRESS;

    const quoteResponse = await jupiter.quoteGet({
        inputMint: inputMint.toString(),
        outputMint: outputMint.toString(),
        amount: 50000000000,
        slippageBps: 50,
        autoSlippage: false,
        computeAutoSlippage: false,
        onlyDirectRoutes: true,
        swapMode: "ExactIn",
        dexes: ALLOWED_DEXES,
    });

    // const quoteResponse = {
    //   inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    //   inAmount: "50000000000",
    //   outputMint: "So11111111111111111111111111111111111111112",
    //   outAmount: "356466797912",
    //   otherAmountThreshold: "354684463923",
    //   swapMode: "ExactIn",
    //   slippageBps: 50,
    //   priceImpactPct: "0.0050",
    //   routePlan: [
    //     {
    //       swapInfo: {
    //         ammKey: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
    //         label: "Whirlpool",
    //         inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    //         outputMint: "So11111111111111111111111111111111111111112",
    //         inAmount: "50000000000",
    //         outAmount: "356466797912",
    //         feeAmount: "1996",
    //         feeMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    //       },
    //       percent: 100,
    //     },
    //   ],
    //   // contextSlot: 259989210,
    //   // timeTaken: 0.0014488,
    // };

    console.log(JSON.stringify(quoteResponse, null, 2));

    const swapLayerProgramId = new PublicKey("AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m");
    const [custodian] = PublicKey.findProgramAddressSync(
        [Buffer.from("custodian")],
        swapLayerProgramId,
    );
    console.log("custodian", custodian.toString());

    const ixResponse = await jupiter.swapInstructionsPost({
        swapRequest: {
            userPublicKey: custodian.toString(),
            useSharedAccounts: true,
            quoteResponse,
        },
    });
    console.log("ixResponse", JSON.stringify(ixResponse, null, 2));

    const ix = InstructionFromJSON(ixResponse.swapInstruction);

    const sharedAccountsRouteAccountLabels = [
        ["token_program", false],
        ["ts/tests/accounts/jupiter/jupiter_custody_owner", true],
        ["user_transfer_authority", false],
        ["source_token_account", false],
        ["ts/tests/accounts/jupiter/jupiter_usdt_custody_token", true],
        ["ts/tests/accounts/jupiter/jupiter_usdc_custody_token", true],
        ["destination_token_account", false],
        ["usdt_mint", false],
        ["usdc_mint", false],
        ["platform_fee_account", false],
        ["token_2022_program", false],
        ["event_authority", false],
        ["program", false],
    ];

    const whirlpoolAccounts = [
        ["whirlpool_program", false],
        ["token_program", false],
        ["jupiter_custody_owner", false],
        ["ts/tests/accounts/whirlpool/whirlpool_usdc_usdt_pool", true],
        ["jupiter_usdt_custody_token", false],
        ["ts/tests/accounts/whirlpool/whirlpool_usdc_vault", true],
        ["jupiter_usdc_custody_token", false],
        ["ts/tests/accounts/whirlpool/whirlpool_usdt_vault", true],
        ["ts/tests/accounts/whirlpool/whirlpool_usdc_usdt_tick_array_0", true],
        ["ts/tests/accounts/whirlpool/whirlpool_usdc_usdt_tick_array_1", true],
        ["ts/tests/accounts/whirlpool/whirlpool_usdc_usdt_tick_array_2", true],
        ["ts/tests/accounts/whirlpool/whirlpool_oracle", false],
    ];

    const allLabels = sharedAccountsRouteAccountLabels.concat(whirlpoolAccounts);
    if (allLabels.length != ix.accounts.length) {
        throw new Error(
            `Mismatch in number of accounts: ${allLabels.length} != ${ix.accounts.length}`,
        );
    }

    for (let i = 0; i < ix.accounts.length; ++i) {
        const key = ix.accounts[i].pubkey.toString();
        const [label, write] = allLabels[i];
        console.log(`pubkey: ${key}, label: ${label}, write to file: ${write}`);
        if (write) {
            const cmd = `solana account -u m -o ${label}.json --output json ${key}`;
            console.log(cmd);
            //execSync(cmd);
        }
    }

    //   console.log(deserializeInstruction(swapInstructionPayload));
}

function deserializeInstruction(instruction: any) {
    return new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        keys: instruction.accounts.map((key: any) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
        })),
        data: Buffer.from(instruction.data, "base64"),
    });
}
