import { Connection } from "@solana/web3.js";
import { USDC_MINT_ADDRESS } from "@wormhole-foundation/example-liquidity-layer-solana/testing";
import { TokenRouterProgram } from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";

const domainToChain = {
    0: { chain: "Ethereum", usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
    1: { chain: "Avalanche", usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
    2: { chain: "Optimism", usdc: "0x0b2c639c533813f4aa9d7837caf62653d097ff85" },
    3: { chain: "Arbitrum", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    6: { chain: "Base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    7: { chain: "Polygon", usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" },
} as const;

main();

async function main() {
    const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

    const tokenMessenger = new TokenRouterProgram(
        connection,
        "tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md",
        USDC_MINT_ADDRESS,
    ).tokenMessengerMinterProgram();

    for (const [domain, cfg] of Object.entries(domainToChain)) {
        const usdcAddress = Array.from(toUniversal(cfg.chain, cfg.usdc).toUint8Array());

        const remoteTokenMessenger = tokenMessenger.remoteTokenMessengerAddress(Number(domain));
        {
            const accInfo = await connection.getAccountInfo(remoteTokenMessenger);
            if (accInfo === null) {
                continue;
            }
        }

        const tokenPair = tokenMessenger.tokenPairAddress(Number(domain), usdcAddress);
        {
            const accInfo = await connection.getAccountInfo(tokenPair);
            if (accInfo === null) {
                continue;
            }
        }

        console.log({
            domain,
            remoteTokenMessenger: remoteTokenMessenger.toString(),
            tokenPair: tokenPair.toString(),
        });
    }
}
