import { InstructionFromJSON, createJupiterApiClient } from "@jup-ag/api";
import * as splToken from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { execSync } from "child_process";
import { argv } from "process";

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

main(argv);

async function main(argv: string[]) {
    if (argv.length < 3) {
        console.error("Usage: testJupV6QuoteFlip.ts <amount>");
        process.exit(1);
    }

    const amount = Number(argv[2]);
    const slippageBps = 200;

    const jupiter = createJupiterApiClient({
        basePath: "https://quote-api.jup.ag/v6",
    });

    const inputMint = USDT_MINT_ADDRESS;
    const outputMint = USDC_MINT_ADDRESS;

    const swapLayerProgramId = new PublicKey("SwapLayer1111111111111111111111111111111111");
    const preparedFill = Keypair.generate().publicKey;
    const [swapAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("swap-authority"), preparedFill.toBuffer()],
        swapLayerProgramId,
    );
    console.log("swapAuthority", swapAuthority.toString());

    {
        const quoteResponse = await jupiter.quoteGet({
            inputMint: inputMint.toString(),
            outputMint: outputMint.toString(),
            amount,
            slippageBps,
            onlyDirectRoutes: true,
            swapMode: "ExactIn",
            dexes: ALLOWED_DEXES,
        });
        console.log(
            "USDT -> USDC, quoteResponse out amounts",
            quoteResponse.outAmount,
            quoteResponse.otherAmountThreshold,
        );

        const ixResponse = await jupiter.swapInstructionsPost({
            swapRequest: {
                userPublicKey: swapAuthority.toString(),
                quoteResponse,
            },
        });
        console.log("ixResponse", JSON.stringify(ixResponse.swapInstruction, null, 2));
    }

    {
        const quoteResponse = await jupiter.quoteGet({
            inputMint: outputMint.toString(),
            outputMint: inputMint.toString(),
            amount,
            slippageBps,
            onlyDirectRoutes: true,
            swapMode: "ExactIn",
            dexes: ALLOWED_DEXES,
        });
        console.log(
            "USDC -> USDT, quoteResponse out amounts",
            quoteResponse.outAmount,
            quoteResponse.otherAmountThreshold,
        );

        const ixResponse = await jupiter.swapInstructionsPost({
            swapRequest: {
                userPublicKey: swapAuthority.toString(),
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
