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

    const swapLayerProgramId = new PublicKey("AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m");
    const [custodian] = PublicKey.findProgramAddressSync(
        [Buffer.from("custodian")],
        swapLayerProgramId,
    );
    console.log("custodian", custodian.toString());

    {
        const quoteResponse = await jupiter.quoteGet({
            inputMint: inputMint.toString(),
            outputMint: outputMint.toString(),
            amount: 50000000000,
            slippageBps: 50,
            onlyDirectRoutes: true,
            swapMode: "ExactIn",
            dexes: ALLOWED_DEXES,
        });

        const ixResponse = await jupiter.swapInstructionsPost({
            swapRequest: {
                userPublicKey: custodian.toString(),
                quoteResponse,
            },
        });
        console.log("ixResponse", JSON.stringify(ixResponse.swapInstruction, null, 2));
    }

    {
        const quoteResponse = await jupiter.quoteGet({
            inputMint: outputMint.toString(),
            outputMint: inputMint.toString(),
            amount: 50000000000,
            slippageBps: 50,
            onlyDirectRoutes: true,
            swapMode: "ExactIn",
            dexes: ALLOWED_DEXES,
        });

        const ixResponse = await jupiter.swapInstructionsPost({
            swapRequest: {
                userPublicKey: custodian.toString(),
                quoteResponse,
            },
        });
        console.log("ixResponse", JSON.stringify(ixResponse.swapInstruction, null, 2));
    }
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
