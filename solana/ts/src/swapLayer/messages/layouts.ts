import {
    CustomConversion,
    Layout,
    LayoutItem,
    LayoutToType,
    ManualSizePureBytes,
    NamedLayoutItem,
    UintLayoutItem,
    deserializeLayout,
    serializeLayout,
    zip,
} from "@wormhole-foundation/sdk-base";
import { layoutItems } from "@wormhole-foundation/sdk-definitions";
import { EvmAddress } from "@wormhole-foundation/sdk-evm";

export type SwapLayerMessage = LayoutToType<typeof swapLayerMessageLayout>;
export type OutputToken = LayoutToType<typeof outputTokenItem>;
export type RedeemMode = LayoutToType<typeof redeemModeItem>;
export type SwapType = LayoutToType<typeof swapItem>;
export type JupiterV6SwapParameters = LayoutToType<typeof jupiterV6SwapParametersLayout>;

export const decodeSwapLayerMessage = (encoded: Uint8Array): SwapLayerMessage =>
    deserializeLayout(swapLayerMessageLayout, encoded);

export const encodeSwapLayerMessage = (message: SwapLayerMessage): Uint8Array =>
    serializeLayout(swapLayerMessageLayout, message);

export const encodeOutputToken = (outputToken: OutputToken): Uint8Array =>
    serializeLayout(outputTokenItem, outputToken);

const forceBigIntConversion = {
    custom: {
        to: (encoded: number) => BigInt(encoded),
        from: (val: bigint) => Number(val),
    } satisfies CustomConversion<number, bigint>,
} as const;

const boolItem = {
    binary: "uint",
    size: 1,
    custom: {
        to: (encoded: number): boolean => encoded > 0,
        from: (val: boolean): number => (val ? 1 : 0),
    } satisfies CustomConversion<number, boolean>,
} as const satisfies UintLayoutItem;

const evmAddressItem = {
    binary: "bytes",
    size: 20,
    custom: {
        to: (encoded: Uint8Array): string => new EvmAddress(encoded).toString(),
        from: (addr: string): Uint8Array => new EvmAddress(addr).toUint8Array(),
    } satisfies CustomConversion<Uint8Array, string>,
} as const satisfies ManualSizePureBytes;

const timestampItem = { binary: "uint", size: 4 } as const satisfies UintLayoutItem;
const amountItem = { binary: "uint", size: 16 } as const satisfies UintLayoutItem;

const gasDropoffItem = {
    binary: "uint",
    size: 4,
} as const satisfies UintLayoutItem;

const redeemModeItem = {
    name: "redeemMode",
    binary: "switch",
    idSize: 1,
    idTag: "mode",
    layouts: [
        [[0, "Direct"], []],
        [
            [1, "Payload"],
            [
                { name: "sender", ...layoutItems.universalAddressItem },
                { name: "buf", binary: "bytes", lengthSize: 2 },
            ],
        ],
        [
            [2, "Relay"],
            [
                { name: "gasDropoff", ...gasDropoffItem },
                { name: "relayingFee", binary: "uint", size: 6, ...forceBigIntConversion },
            ],
        ],
    ],
} as const satisfies NamedLayoutItem;

const sharedUniswapTraderJoeLayout = [
    { name: "firstPoolId", binary: "uint", size: 3 },
    {
        name: "path",
        binary: "array",
        lengthSize: 1,
        layout: [
            { name: "address", ...evmAddressItem },
            { name: "poolId", binary: "uint", size: 3 },
        ],
    },
] as const satisfies Layout;

const jupiterV6SwapParametersLayout = [
    {
        name: "dexProgramId",
        binary: "switch",
        idSize: 1,
        idTag: "isSome",
        layouts: [
            [[0, false], []],
            [[1, true], [{ name: "address", ...layoutItems.universalAddressItem }]],
        ],
    },
] as const satisfies Layout;

const [swapTypes, swapItemLayouts] = [
    [
        [1, "UniswapV3"],
        [2, "TraderJoe"],
        [16, "JupiterV6"],
    ],
    [sharedUniswapTraderJoeLayout, sharedUniswapTraderJoeLayout, jupiterV6SwapParametersLayout],
] as const;

const swapItem = {
    name: "swap",
    binary: "bytes",
    layout: [
        { name: "deadline", ...timestampItem },
        { name: "limitAmount", ...amountItem },
        { name: "type", binary: "switch", idSize: 1, layouts: zip([swapTypes, swapItemLayouts]) },
    ],
} as const satisfies NamedLayoutItem;

const [ioTokenTypes, outputTokenLayouts] = [
    [
        [0, "Usdc"],
        [1, "Gas"],
        [2, "Other"],
    ],
    [[], [swapItem], [{ name: "address", ...layoutItems.universalAddressItem }, swapItem]],
] as const;

const outputTokenItem = {
    name: "outputToken",
    binary: "switch",
    idSize: 1,
    idTag: "type",
    layouts: zip([ioTokenTypes, outputTokenLayouts]),
} as const satisfies NamedLayoutItem;

// ---- message layout ----

const swapLayerMessageLayout = [
    { name: "version", binary: "uint", size: 1, custom: 1, omit: true },
    { name: "recipient", ...layoutItems.universalAddressItem },
    redeemModeItem,
    outputTokenItem,
] as const satisfies Layout;
