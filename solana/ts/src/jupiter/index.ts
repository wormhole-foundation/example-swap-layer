import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import * as jupiter from "@jup-ag/api";

export function toTransactionInstruction(instruction: jupiter.Instruction): TransactionInstruction {
    return {
        programId: new PublicKey(instruction.programId),
        keys: instruction.accounts.map((key: any) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
        })),
        data: Buffer.from(instruction.data, "base64"),
    };
}
