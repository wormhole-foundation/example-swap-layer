import { InstructionFromJSON, createJupiterApiClient } from "@jup-ag/api";
import * as splToken from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { execSync } from "child_process";
import { argv } from "process";

const USDC_MINT_ADDRESS = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const ALLOWED_DEXES = ["Phoenix"];

main(argv);

async function main(argv: string[]) {
    const price = 145;
    const slippageBps = 200;

    const jupiter = createJupiterApiClient({
        basePath: "https://quote-api.jup.ag/v6",
    });

    const inputMint = splToken.NATIVE_MINT;
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
            amount: 100_000 * Math.floor(1_000_000_000 / price),
            slippageBps,
            onlyDirectRoutes: true,
            swapMode: "ExactIn",
            dexes: ALLOWED_DEXES,
        });
        console.log(
            "WSOL -> USDC, quoteResponse out amounts",
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
        for (let i = 13; i < ixResponse.swapInstruction.accounts.length; i++) {
            const account = ixResponse.swapInstruction.accounts[i].pubkey;
            const cmd = `solana account -u m -o collected/${account}.json --output json ${account}`;
            console.log(cmd);
            try {
                execSync(cmd);
            } catch (_) {
                console.log("uh oh, failed");
            }
        }
    }

    {
        const quoteResponse = await jupiter.quoteGet({
            inputMint: outputMint.toString(),
            outputMint: inputMint.toString(),
            amount: 100_000_000_000,
            slippageBps,
            onlyDirectRoutes: true,
            swapMode: "ExactIn",
            dexes: ALLOWED_DEXES,
        });
        console.log(
            "USDC -> WSOL, quoteResponse out amounts",
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
        for (let i = 13; i < ixResponse.swapInstruction.accounts.length; i++) {
            const account = ixResponse.swapInstruction.accounts[i].pubkey;
            const cmd = `solana account -u m -o collected/${account}.json --output json ${account}`;
            console.log(cmd);
            try {
                execSync(cmd);
            } catch (_) {
                console.log("uh oh, failed");
            }
        }
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
