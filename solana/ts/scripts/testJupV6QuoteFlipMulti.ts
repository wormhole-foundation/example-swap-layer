import { createJupiterApiClient } from "@jup-ag/api";
import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { execSync } from "child_process";
import { argv } from "process";

const USDC_MINT_ADDRESS = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const visitedKeys = new Set<string>();

main(argv);

async function main(argv: string[]) {
    const connection = new Connection("https://api.mainnet-beta.solana.com");

    const price = 0.0045;
    const slippageBps = 500;

    const jupiter = createJupiterApiClient({
        basePath: "https://quote-api.jup.ag/v6",
    });

    const inputMint = new PublicKey("CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo");
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
            amount: 1_000 * Math.floor(100_000 / price),
            slippageBps,
            // onlyDirectRoutes: true,
            restrictIntermediateTokens: true,
            swapMode: "ExactIn",
            excludeDexes: ["Whirlpool", "Phoenix"],
            // dexes: ALLOWED_DEXES,
        });
        console.log(
            "XYZ -> USDC, quoteResponse out amounts",
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
        console.log("luts", ixResponse.addressLookupTableAddresses);
        for (let i = 13; i < ixResponse.swapInstruction.accounts.length; i++) {
            await getAccount(connection, ixResponse.swapInstruction.accounts[i].pubkey);
        }
    }

    {
        const quoteResponse = await jupiter.quoteGet({
            inputMint: outputMint.toString(),
            outputMint: inputMint.toString(),
            amount: 1_000,
            slippageBps,
            // onlyDirectRoutes: true,
            restrictIntermediateTokens: true,
            swapMode: "ExactIn",
            // dexes: ALLOWED_DEXES,
        });
        console.log(
            "USDC -> XYZ, quoteResponse out amounts",
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
        console.log("luts", ixResponse.addressLookupTableAddresses);
        for (let i = 13; i < ixResponse.swapInstruction.accounts.length; i++) {
            await getAccount(connection, ixResponse.swapInstruction.accounts[i].pubkey);
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

async function getAccount(connection: Connection, account: string) {
    if (visitedKeys.has(account)) {
        return;
    }

    visitedKeys.add(account);

    // sleep for 4 seconds
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const accInfo = await connection.getAccountInfo(new PublicKey(account), {
        commitment: "confirmed",
        dataSlice: { offset: 0, length: 8 },
    });

    if (accInfo === null || accInfo.executable) {
        console.log("skipping", account);
        return;
    }

    const cmd = `solana account -u m -o collected/${account}.json --output json ${account}`;
    console.log(cmd);
    try {
        execSync(cmd);
    } catch (_) {
        console.log("uh oh, failed");
    }
}
