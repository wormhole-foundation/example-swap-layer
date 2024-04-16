import * as anchor from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expectIxOk } from "./helpers";
import {
    LOCALHOST,
    PAYER_KEYPAIR,
    OWNER_KEYPAIR,
    OWNER_ASSISTANT_KEYPAIR,
    FEE_UPDATER_KEYPAIR,
    USDC_MINT_ADDRESS,
} from "./helpers";
import { SwapLayerProgram, localnet, Custodian } from "../src/swapLayer";
import { use as chaiUse, expect } from "chai";
import * as tokenRouterSdk from "../../lib/example-liquidity-layer/solana/ts/src/tokenRouter";

chaiUse(require("chai-as-promised"));

describe("swap-layer", () => {
    const connection = new Connection(LOCALHOST, "processed");
    const payer = PAYER_KEYPAIR;
    const relayer = Keypair.generate();
    const owner = OWNER_KEYPAIR;
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;
    const feeUpdater = FEE_UPDATER_KEYPAIR;

    const feeRecipient = Keypair.generate();
    const feeRecipientToken = splToken.getAssociatedTokenAddressSync(
        USDC_MINT_ADDRESS,
        feeRecipient.publicKey
    );

    const swapLayer = new SwapLayerProgram(connection, localnet(), USDC_MINT_ADDRESS);

    const tokenRouter = new tokenRouterSdk.TokenRouterProgram(
        connection,
        tokenRouterSdk.testnet(),
        USDC_MINT_ADDRESS
    );

    describe("Admin", () => {
        describe("Initialize", () => {
            it("Initialize", async () => {
                const ix = await swapLayer.initializeIx({
                    owner: payer.publicKey,
                    ownerAssistant: ownerAssistant.publicKey,
                    feeRecipient: feeRecipient.publicKey,
                    feeUpdater: feeUpdater.publicKey,
                });

                await expectIxOk(connection, [ix], [payer]);

                const custodianData = await swapLayer.fetchCustodian();
                expect(custodianData).to.eql(
                    new Custodian(
                        payer.publicKey,
                        null,
                        ownerAssistant.publicKey,
                        feeRecipientToken,
                        feeUpdater.publicKey
                    )
                );
            });

            before("Set up Token Accounts", async function () {
                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    feeRecipient.publicKey
                );

                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    PublicKey.default
                );

                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    SystemProgram.programId
                );
            });
        });
    });

    describe("Business Logic", function () {
        describe("Native Gas Drop-off", function () {});

        describe("Jupiter V6 Swap", function () {
            // TODO

            before("Not Paused", async function () {
                const custodian = await tokenRouter.fetchCustodian();
                expect(custodian.paused).is.false;
            });
        });
    });
});
