import * as splToken from "@solana/spl-token";
import { AddressLookupTableProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { expectIxOk } from "@wormhole-foundation/example-liquidity-layer-solana/testing";
import { Chain } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";

export function tryNativeToUint8Array(address: string, chain: Chain) {
    return toUniversal(chain, address).toUint8Array();
}

export async function createLut(connection: Connection, payer: Keypair, addresses: PublicKey[]) {
    // Create.
    const [createIx, lookupTable] = await connection.getSlot("finalized").then((slot) =>
        AddressLookupTableProgram.createLookupTable({
            authority: payer.publicKey,
            payer: payer.publicKey,
            recentSlot: slot,
        }),
    );

    await expectIxOk(connection, [createIx], [payer]);

    for (let i = 0; i < addresses.length; i += 20) {
        // Extend.
        const extendIx = AddressLookupTableProgram.extendLookupTable({
            payer: payer.publicKey,
            authority: payer.publicKey,
            lookupTable,
            addresses: addresses.slice(i, i + 20),
        });

        await expectIxOk(connection, [extendIx], [payer]);
    }

    return lookupTable;
}

export async function whichTokenProgram(connection: Connection, interfaceAccount: PublicKey) {
    const accInfo = await connection.getAccountInfo(interfaceAccount);
    return accInfo.owner;
}

export async function createAta(
    connection: Connection,
    payer: Keypair,
    mint: PublicKey,
    owner: PublicKey,
) {
    const accInfo = await connection.getAccountInfo(mint);
    const tokenProgram = accInfo.owner;

    const recipientToken = splToken.getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);

    await expectIxOk(
        connection,
        [
            splToken.createAssociatedTokenAccountIdempotentInstruction(
                payer.publicKey,
                recipientToken,
                owner,
                mint,
                tokenProgram,
            ),
        ],
        [payer],
    );

    return recipientToken;
}
