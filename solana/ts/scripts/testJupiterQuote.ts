import {
    InstructionFromJSON,
    createJupiterApiClient,
    QuoteGetRequest,
    SwapInstructionsPostRequest,
} from "@jup-ag/api";
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

    const quoteRequest = {
        inputMint: inputMint.toString(),
        outputMint: outputMint.toString(),
        amount: 50000000000,
        slippageBps: 50,
        autoSlippage: false,
        computeAutoSlippage: false,
        onlyDirectRoutes: true,
        swapMode: "ExactIn",
        dexes: ALLOWED_DEXES,
    } as QuoteGetRequest;
    console.log({ quoteRequest });

    const quoteResponse = await jupiter.quoteGet(quoteRequest);
    console.log({ quoteResponse });

    const swapLayerProgramId = new PublicKey("SwapLayer1111111111111111111111111111111111");
    const [swapAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("swap-authority")],
        swapLayerProgramId,
    );
    console.log("swap authority:", swapAuthority.toString());

    const swapInstructionRequest = {
        swapRequest: {
            userPublicKey: swapAuthority.toString(),
            useSharedAccounts: true,
            quoteResponse,
        },
    } as SwapInstructionsPostRequest;
    console.log({ swapInstructionRequest });

    const swapInstructionResponse = await jupiter.swapInstructionsPost(swapInstructionRequest);
    console.log({ swapInstructionResponse });
}
