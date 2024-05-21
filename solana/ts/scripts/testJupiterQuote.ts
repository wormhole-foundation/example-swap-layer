import {
    InstructionToJSON,
    QuoteGetRequest,
    SwapInfoToJSON,
    SwapInstructionsPostRequest,
    SwapInstructionsResponseToJSON,
    SwapRequestToJSON,
    SwapResponseToJSON,
    createJupiterApiClient,
} from "@jup-ag/api";
import { PublicKey } from "@solana/web3.js";

const mintKeys = {
    usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    usdt: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    wsol: "So11111111111111111111111111111111111111112",
    sol: "So11111111111111111111111111111111111111112",
} as const;

const ALLOWED_DEXES = [
    //"Lifinity V2", // use
    //"Meteora DLMM", // use
    "Phoenix", // use
    //"Raydium CLMM", // use
    // "Whirlpool", // use
];

main(process.argv);

async function main(argv: string[]) {
    const [, , amountIn, inputMint, outputMint] = argv;
    if (amountIn === undefined || inputMint === undefined || outputMint === undefined) {
        console.error(
            "Usage: yarn ts-node testJupiterQuote.ts <amountIn> <inputMint> <outputMint>",
        );
        process.exit(1);
    }

    const jupiter = createJupiterApiClient({
        basePath: "https://quote-api.jup.ag/v6",
    });

    const quoteRequest: QuoteGetRequest = {
        inputMint: mintKeys[inputMint] || new PublicKey(inputMint).toString(),
        outputMint: mintKeys[outputMint] || new PublicKey(outputMint).toString(),
        amount: Number(amountIn),
        slippageBps: 50,
        autoSlippage: false,
        computeAutoSlippage: false,
        onlyDirectRoutes: true,
        swapMode: "ExactIn",
        dexes: ALLOWED_DEXES,
    };
    console.log({ quoteRequest });

    const quoteResponse = await jupiter.quoteGet(quoteRequest);
    console.log({ quoteResponse });

    const swapAuthority = new PublicKey("Bro1111111111111111111111111111111111111111");
    console.log("swap authority:", swapAuthority.toString());

    const swapInstructionRequest: SwapInstructionsPostRequest = {
        swapRequest: {
            userPublicKey: swapAuthority.toString(),
            useSharedAccounts: true,
            quoteResponse,
        },
    };
    console.log({ swapInstructionRequest });

    const swapInstructionResponse = await jupiter.swapInstructionsPost(swapInstructionRequest);
    console.log(JSON.stringify(swapInstructionResponse.swapInstruction, null, 2));
}
