import {
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    Signer,
    TransactionInstruction,
} from "@solana/web3.js";
import * as splToken from "@solana/spl-token";
import {
    OrderResponse,
    LiquidityLayerTransactionResult,
} from "@wormhole-foundation/example-liquidity-layer-evm";
import { UniversalAddress, deserialize, toUniversal } from "@wormhole-foundation/sdk-definitions";
import { CORE_BRIDGE_PID, USDT_MINT_ADDRESS } from "../../../solana/ts/tests/helpers";
import {
    CircleAttester,
    expectIxOk,
    postVaa,
} from "@wormhole-foundation/example-liquidity-layer-solana/testing";
import { utils as coreUtils } from "@wormhole-foundation/sdk-solana-core";
import { ethers } from "ethers";
import { TokenRouterProgram } from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter";
import { OutputToken, SwapLayerProgram } from "../../../solana/ts/src/swapLayer";
import { Uint64 } from "@wormhole-foundation/example-liquidity-layer-solana/common";
import { Chain, toChainId } from "@wormhole-foundation/sdk-base";
import * as jupiterV6 from "../../../solana/ts/src/jupiterV6";
import {
    EVM_CONFIG,
    GUARDIAN_SET_INDEX,
    GuardianNetwork,
    USDC_MINT_ADDRESS,
    circleContract,
    usdtContract,
} from ".";

export async function postSignedVaa(
    connection: Connection,
    payer: Keypair,
    vaa: Uint8Array | Buffer,
) {
    await postVaa(connection, payer, Buffer.from(vaa));
    const parsed = deserialize("Uint8Array", vaa);
    return coreUtils.derivePostedVaaKey(CORE_BRIDGE_PID, Buffer.from(parsed.hash));
}

export async function getCircleMessageSolana(
    tokenRouter: TokenRouterProgram,
    preparedOrder: PublicKey,
) {
    const cctpMessage = tokenRouter.cctpMessageAddress(preparedOrder);
    const messageTransmitter = tokenRouter.messageTransmitterProgram();
    const { message } = await messageTransmitter.fetchMessageSent(cctpMessage);
    return message;
}

export async function redeemFillOnSolana(
    connection: Connection,
    payer: Keypair,
    tokenRouter: TokenRouterProgram,
    tokenRouterLkupTable: PublicKey,
    accounts: {
        vaa: PublicKey;
        routerEndpoint?: PublicKey;
    },
    args: {
        encodedCctpMessage: Buffer;
        cctpAttestation: Buffer;
    },
) {
    const ix = await tokenRouter.redeemCctpFillIx({ payer: payer.publicKey, ...accounts }, args);

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 300_000,
    });

    const { value: lookupTableAccount } =
        await connection.getAddressLookupTable(tokenRouterLkupTable);

    await expectIxOk(connection, [computeIx, ix], [payer], {
        addressLookupTableAccounts: [lookupTableAccount!],
    });

    return tokenRouter.preparedFillAddress(accounts.vaa);
}

type StageOutboundArgs = {
    exactIn?: boolean;
    transferType?: "sender" | "native";
    redeemOption?:
        | { relay: { gasDropoff: number; maxRelayerFee: Uint64 } }
        | { payload: Uint8Array | Buffer }
        | null;
    outputToken?: OutputToken | null;
    minAmountOut?: bigint;
};

export async function stageOutboundOnSolana(
    swapLayer: SwapLayerProgram,
    amountIn: bigint,
    targetChain: Chain,
    foreignRecipientAddress: number[],
    payer: Keypair,
    accounts: {
        senderToken: PublicKey;
        sender?: PublicKey;
        srcMint?: PublicKey;
        usdcRefundToken: PublicKey;
    },
    opts: StageOutboundArgs = {},
) {
    const stagedOutboundSigner = Keypair.generate();
    const stagedOutbound = stagedOutboundSigner.publicKey;

    let { redeemOption, outputToken, transferType, exactIn, minAmountOut } = opts;
    redeemOption ??= null;
    outputToken ??= null;
    transferType ??= "sender";
    exactIn ??= false;

    const [, ix] = await swapLayer.stageOutboundIx(
        {
            payer: payer.publicKey,
            ...accounts,
            stagedOutbound,
        },
        {
            transferType,
            amountIn,
            minAmountOut,
            isExactIn: exactIn,
            targetChain: toChainId(targetChain),
            recipient: foreignRecipientAddress,
            redeemOption,
            outputToken,
        },
    );

    await expectIxOk(swapLayer.connection(), [ix], [payer, stagedOutboundSigner]);

    const stagedCustodyToken = swapLayer.stagedCustodyTokenAddress(stagedOutbound);
    const preparedOrder = swapLayer.preparedOrderAddress(stagedOutbound);

    return { stagedOutbound, stagedCustodyToken, preparedOrder };
}

const JUPITER_V6_LUT_ADDRESSES = [
    new PublicKey("GxS6FiQ3mNnAar9HGQ6mxP7t6FcwmHkU7peSeQDUHmpN"),
    new PublicKey("HsLPzBjqK3SUKQZwHdd2QHVc9cioPrsHNw9GcUDs7WL7"),
];

const luts: PublicKey[] = [];
for (let i = 0; i < JUPITER_V6_LUT_ADDRESSES.length; ++i) {
    luts.push(JUPITER_V6_LUT_ADDRESSES[i]);
}

export async function completeSwapForTest(
    swapLayer: SwapLayerProgram,
    connection: Connection,
    accounts: {
        payer: PublicKey;
        preparedFill: PublicKey;
        recipient: PublicKey;
        recipientToken?: PublicKey;
        dstMint?: PublicKey;
    },
    opts: {
        redeemMode: "direct" | "relay";
        signers: Signer[];
        inAmount?: bigint;
        quotedAmountOut?: bigint;
        swapResponseModifier: (
            tokenOwner: PublicKey,
            opts: jupiterV6.ModifySharedAccountsRouteOpts,
        ) => Promise<jupiterV6.ModifiedSharedAccountsRoute>;
        additionalLuts?: PublicKey[];
    },
): Promise<undefined> {
    let { signers, swapResponseModifier, additionalLuts } = opts;

    additionalLuts ??= [];

    const { instruction: cpiInstruction } = await swapResponseModifier(
        swapLayer.swapAuthorityAddress(accounts.preparedFill),
        {
            cpi: true,
            inAmount: opts.inAmount,
            quotedOutAmount: opts.quotedAmountOut,
        },
    );

    let ix;
    if (opts.redeemMode === "direct") {
        ix = await swapLayer.completeSwapDirectIx(accounts, { cpiInstruction });
    } else if (opts.redeemMode === "relay") {
        ix = await swapLayer.completeSwapRelayIx(accounts, { cpiInstruction });
    }

    const ixs = [
        ComputeBudgetProgram.setComputeUnitLimit({
            units: 700_000,
        }),
        ix,
    ];

    const addressLookupTableAccounts = await Promise.all(
        [...luts, ...additionalLuts].map(async (lookupTableAddress) => {
            const resp = await connection.getAddressLookupTable(lookupTableAddress);
            return resp.value!;
        }),
    );

    await expectIxOk(swapLayer.connection(), ixs, signers, {
        addressLookupTableAccounts,
    });
}

export async function swapExactInForTest(
    swapLayer: SwapLayerProgram,
    accounts: {
        payer: PublicKey;
        stagedOutbound: PublicKey;
        stagedCustodyToken?: PublicKey;
        preparedOrder?: PublicKey;
        srcMint?: PublicKey;
        srcTokenProgram?: PublicKey;
        preparedBy?: PublicKey;
        usdcRefundToken?: PublicKey;
        srcResidual?: PublicKey;
    },
    args: {
        cpiInstruction: TransactionInstruction;
    },
    opts: {
        additionalLuts?: PublicKey[];
        signers: Signer[];
    },
) {
    let { additionalLuts, signers } = opts;
    additionalLuts ??= [];

    const ix = await swapLayer.initiateSwapExactInIx(accounts, args);

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 700_000,
    });

    const addressLookupTableAccounts = await Promise.all(
        [...luts, ...additionalLuts].map(async (lookupTableAddress) => {
            const resp = await swapLayer.connection().getAddressLookupTable(lookupTableAddress);
            return resp.value!;
        }),
    );

    await expectIxOk(swapLayer.connection(), [computeIx, ix], signers, {
        addressLookupTableAccounts,
    });
}

export async function getUsdtAtaBalance(connection, owner) {
    return splToken
        .getAccount(connection, splToken.getAssociatedTokenAddressSync(USDT_MINT_ADDRESS, owner))
        .then((token) => token.amount)
        .catch(() => 0n);
}

export async function getUsdtBalanceEthereum(wallet: ethers.Wallet): Promise<ethers.BigNumber> {
    const { contract } = usdtContract();

    return contract.balanceOf(wallet.address);
}

export async function initiateOnEvmSwapLayer(
    encodedArgs: Uint8Array,
    recipient: UniversalAddress,
    fromChain: Chain,
    toChain: Chain,
    contract: ethers.Contract,
    overrides?: { value: ethers.BigNumber },
): Promise<{ orderResponse: OrderResponse; receipt: ethers.providers.TransactionReceipt }> {
    const guardianNetwork = new GuardianNetwork(GUARDIAN_SET_INDEX);
    const circleAttester = new CircleAttester();
    const fromConfig = EVM_CONFIG[fromChain];

    if (overrides === undefined) {
        overrides = { value: ethers.BigNumber.from(0) };
    }

    const receipt = await contract
        .initiate(toChainId(toChain), recipient.address, encodedArgs, overrides)
        .then((tx) => tx.wait());

    // Fetch the vaa and cctp attestation.
    const result = LiquidityLayerTransactionResult.fromEthersTransactionReceipt(
        toChainId(fromChain),
        fromConfig.tokenRouter,
        fromConfig.coreBridge,
        receipt,
        await circleContract(fromChain).then((c) => c.messageTransmitter.address),
    );

    // Create a signed VAA and circle attestation.
    const fillVaa = await guardianNetwork.observeEvm(contract.provider, fromChain, receipt);

    return {
        orderResponse: {
            encodedWormholeMessage: Buffer.from(fillVaa),
            circleBridgeMessage: result.circleMessage!,
            circleAttestation: circleAttester.createAttestation(result.circleMessage!),
        },
        receipt,
    };
}

type SwapArgs = {
    swapResponseModifier?: (
        tokenOwner: PublicKey,
        opts: jupiterV6.ModifySharedAccountsRouteOpts,
    ) => Promise<jupiterV6.ModifiedSharedAccountsRoute>;
    slippageBps?: number;
    inAmount?: bigint;
    quotedOutAmount?: bigint;
};

export async function initiateOnSolanaSwapLayer(
    swapLayer: SwapLayerProgram,
    payer: Keypair,
    amountIn: bigint,
    toChain: Chain,
    recipient: UniversalAddress,
    accounts: {
        senderToken?: PublicKey;
        sender?: PublicKey;
        srcMint?: PublicKey;
        usdcRefundToken?: PublicKey;
    },
    opts: StageOutboundArgs & SwapArgs = {},
): Promise<OrderResponse> {
    const connection = swapLayer.connection();
    const tokenRouter = swapLayer.tokenRouterProgram();
    const guardianNetwork = new GuardianNetwork(GUARDIAN_SET_INDEX);
    const circleAttester = new CircleAttester();

    // Accounts.
    let { senderToken, srcMint, usdcRefundToken } = accounts;
    srcMint ??= USDC_MINT_ADDRESS;
    senderToken ??= splToken.getAssociatedTokenAddressSync(srcMint, payer.publicKey);
    usdcRefundToken ??= splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, payer.publicKey);

    // Opts.
    let { redeemOption, outputToken, transferType, exactIn } = opts;
    let { swapResponseModifier, slippageBps, inAmount, quotedOutAmount } = opts;

    // Opts.
    const { stagedOutbound, stagedCustodyToken, preparedOrder } = await stageOutboundOnSolana(
        swapLayer,
        amountIn,
        toChain,
        Array.from(recipient.address),
        payer,
        {
            senderToken,
            usdcRefundToken,
            ...accounts,
        },
        {
            redeemOption,
            outputToken,
            transferType,
            exactIn,
            minAmountOut: quotedOutAmount,
        },
    );

    if (swapResponseModifier === undefined) {
        // Send the transfer.
        const initiateIx = await swapLayer.initiateTransferIx({
            payer: payer.publicKey,
            preparedOrder,
            stagedOutbound,
            stagedCustodyToken,
        });
        await expectIxOk(connection, [initiateIx], [payer]);
    } else {
        const swapAuthority = swapLayer.swapAuthorityAddress(preparedOrder);
        const { instruction: cpiInstruction } = await swapResponseModifier(swapAuthority, {
            cpi: true,
            inAmount,
            quotedOutAmount,
            slippageBps,
        });

        await swapExactInForTest(
            swapLayer,
            {
                payer: payer.publicKey,
                stagedOutbound,
                stagedCustodyToken,
                preparedOrder,
                srcMint,
            },
            { cpiInstruction },
            { signers: [payer] },
        );
    }

    const ix = await swapLayer.tokenRouterProgram().placeMarketOrderCctpIx(
        {
            payer: payer.publicKey,
            preparedOrder: preparedOrder,
        },
        {
            targetChain: toChainId(toChain),
        },
    );

    await expectIxOk(connection, [ix], [payer]);

    // Create a signed VAA and circle attestation.
    const fillVaa = await guardianNetwork.observeSolana(
        connection,
        tokenRouter.coreMessageAddress(preparedOrder),
    );
    const circleMessage = await getCircleMessageSolana(tokenRouter, preparedOrder);

    return {
        encodedWormholeMessage: fillVaa,
        circleBridgeMessage: circleMessage,
        circleAttestation: circleAttester.createAttestation(circleMessage),
    };
}
