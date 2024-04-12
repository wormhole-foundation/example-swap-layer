import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import fetch from "node-fetch";
import * as splToken from "@solana/spl-token";
import {
  createJupiterApiClient,
  InstructionFromJSON,
  InstructionFromJSONTyped,
} from "@jup-ag/api";

const USDC_MINT_ADDRESS = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
const USDT_MINT_ADDRESS = new PublicKey(
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
);

const ALLOWED_DEXES = [
  //   "Lifinity V2",
  //   "Meteora",
  //   "Meteora DLMM",
  //   "Orca V2",
  //   "Phoenix",
  //   "Raydium",
  //   "Raydium CLMM",
  "Whirlpool",
];

main();

async function main() {
  const jupiter = createJupiterApiClient({
    basePath: "https://quote-api.jup.ag/v6",
  });

  //   const quoteResponse = await jupiter.quoteGet({
  //     inputMint: USDC_MINT_ADDRESS.toBase58(),
  //     outputMint: splToken.NATIVE_MINT.toBase58(),
  //     amount: 50000000000,
  //     slippageBps: 50,
  //     onlyDirectRoutes: true, // Maybe set to false if using `restrictIntermediateTokens`.
  //     swapMode: "ExactIn",
  //     dexes: ALLOWED_DEXES,
  //     // restrictIntermediateTokens: true, // This might be interesting to use. Research this.
  //   });

  const quoteResponse = {
    inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    inAmount: "50000000000",
    outputMint: "So11111111111111111111111111111111111111112",
    outAmount: "356466797912",
    otherAmountThreshold: "354684463923",
    swapMode: "ExactIn",
    slippageBps: 50,
    priceImpactPct: "0.0050",
    routePlan: [
      {
        swapInfo: {
          ammKey: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
          label: "Whirlpool",
          inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          outputMint: "So11111111111111111111111111111111111111112",
          inAmount: "50000000000",
          outAmount: "356466797912",
          feeAmount: "1996",
          feeMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        },
        percent: 100,
      },
    ],
    // contextSlot: 259989210,
    // timeTaken: 0.0014488,
  };

  console.log(JSON.stringify(quoteResponse, null, 2));

  const guy = Keypair.generate();
  //   // Check later.
  const ata = splToken.getAssociatedTokenAddressSync(
    splToken.NATIVE_MINT,
    guy.publicKey
  );
  console.log("ata", ata.toString());
  const wtf = await jupiter.swapInstructionsPost({
    swapRequest: {
      userPublicKey: guy.publicKey.toString(),
      // @ts-ignore
      quoteResponse,
    },
  });
  console.log(InstructionFromJSON(wtf.swapInstruction));

  //   // Check later.
  //   const ata = splToken.getAssociatedTokenAddressSync(
  //     splToken.NATIVE_MINT,
  //     guy.publicKey
  //   );

  //   const ixResponse = await (
  //     await fetch("https://quote-api.jup.ag/v6/swap-instructions", {
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify({
  //         // quoteResponse from /quote api
  //         quoteResponse: CANNED_QUOTE,
  //         userPublicKey: guy.publicKey.toBase58(),
  //       }),
  //     })
  //   ).json();

  //   if (ixResponse.error) {
  //     throw new Error("Failed to get swap instructions: " + ixResponse.error);
  //   }

  //   const {
  //     tokenLedgerInstruction, // If you are using `useTokenLedger = true`.
  //     computeBudgetInstructions, // The necessary instructions to setup the compute budget.
  //     setupInstructions, // Setup missing ATA for the users.
  //     swapInstruction: swapInstructionPayload, // The actual swap instruction.
  //     cleanupInstruction, // Unwrap the SOL if `wrapAndUnwrapSol = true`.
  //     addressLookupTableAddresses, // The lookup table addresses that you can use if you are using versioned transaction.
  //   } = ixResponse;

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
