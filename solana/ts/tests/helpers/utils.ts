import { AddressLookupTableProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { expectIxOk } from "../../../../lib/example-liquidity-layer/solana/ts/tests/helpers";

export function hackedExpectDeepEqual(left: any, right: any) {
    expect(JSON.parse(JSON.stringify(left))).to.eql(JSON.parse(JSON.stringify(right)));
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

    // Extend.
    const extendIx = AddressLookupTableProgram.extendLookupTable({
        payer: payer.publicKey,
        authority: payer.publicKey,
        lookupTable,
        addresses,
    });

    await expectIxOk(connection, [extendIx], [payer], {
        confirmOptions: { commitment: "finalized" },
    });

    return lookupTable;
}
