import { Keypair, PublicKey } from "@solana/web3.js";

export const FEE_UPDATER_KEYPAIR = Keypair.fromSecretKey(
    Buffer.from(
        "rI0Zx3zKrtyTbkR6tjGflafgMUJFoVSOnPikC2FPl1dyHvGqDulylhs8RuGza/GcmplFUU/jqMXBxiPy2RhgMQ==",
        "base64",
    ),
);

export const CORE_BRIDGE_PID = new PublicKey("3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5");

export const USDC_MINT_ADDRESS = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
