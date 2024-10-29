import { Keypair, PublicKey } from "@solana/web3.js";
import { Chain } from "@wormhole-foundation/sdk-base";

export const CORE_BRIDGE_PID = new PublicKey("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");
export const GUARDIAN_KEY = "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";

export const FEE_UPDATER_KEYPAIR = Keypair.fromSecretKey(
    Buffer.from(
        "rI0Zx3zKrtyTbkR6tjGflafgMUJFoVSOnPikC2FPl1dyHvGqDulylhs8RuGza/GcmplFUU/jqMXBxiPy2RhgMQ==",
        "base64",
    ),
);

export const USDT_MINT_ADDRESS = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
export const BERN_MINT_ADDRESS = new PublicKey("CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo");
export const BONK_MINT_ADDRESS = new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");

export const WHIRLPOOL_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
export const WHIRLPOOL_USDC_USDT = new PublicKey("4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4");

export const REGISTERED_PEERS: { [k in Chain]?: Array<number> } = {
    Ethereum: Array.from(Buffer.alloc(32, "50", "hex")),
};
