import { PublicKey } from "@solana/web3.js";

export class Custodian {
    owner: PublicKey;
    pendingOwner: PublicKey | null;
    ownerAssistant: PublicKey;
    feeRecipientToken: PublicKey;
    feeUpdater: PublicKey;

    constructor(
        owner: PublicKey,
        pendingOwner: PublicKey | null,
        ownerAssistant: PublicKey,
        feeRecipientToken: PublicKey,
        feeUpdater: PublicKey,
    ) {
        this.owner = owner;
        this.pendingOwner = pendingOwner;
        this.ownerAssistant = ownerAssistant;
        this.feeRecipientToken = feeRecipientToken;
        this.feeUpdater = feeUpdater;
    }
}
