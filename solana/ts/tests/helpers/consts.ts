import { Keypair, PublicKey } from "@solana/web3.js";

export const CORE_BRIDGE_PID = new PublicKey("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");
export const GUARDIAN_KEY = "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";

export const FEE_UPDATER_KEYPAIR = Keypair.fromSecretKey(
    Buffer.from(
        "rI0Zx3zKrtyTbkR6tjGflafgMUJFoVSOnPikC2FPl1dyHvGqDulylhs8RuGza/GcmplFUU/jqMXBxiPy2RhgMQ==",
        "base64",
    ),
);
