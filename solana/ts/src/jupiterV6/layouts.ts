import {
    CustomConversion,
    Layout,
    LayoutToType,
    SwitchLayoutItem,
    UintLayoutItem,
    deserializeLayout,
    serializeLayout,
} from "@wormhole-foundation/sdk-base";

export type SharedAccountsRouteArgs = LayoutToType<typeof sharedAccountsRouteArgsLayout>;

export const decodeSharedAccountsRouteArgs = (data: Buffer | Uint8Array): SharedAccountsRouteArgs =>
    deserializeLayout(sharedAccountsRouteArgsLayout, Uint8Array.from(data));

export const encodeSharedAccountsRouteArgs = (decoded: SharedAccountsRouteArgs): Buffer =>
    Buffer.from(serializeLayout(sharedAccountsRouteArgsLayout, decoded));

const boolItem = {
    binary: "uint",
    size: 1,
    custom: {
        to: (encoded: number): boolean => encoded > 0,
        from: (val: boolean): number => (val ? 1 : 0),
    } satisfies CustomConversion<number, boolean>,
} as const satisfies UintLayoutItem;

const sideItem = {
    binary: "switch",
    idSize: 1,
    layouts: [
        [[0, "Bid"], []],
        [[1, "Ask"], []],
    ],
} as const satisfies SwitchLayoutItem;

const swapItem = {
    binary: "switch",
    idSize: 1,
    layouts: [
        [[0, "Saber"], []],
        [[1, "SaberAddDecimalsDeposit"], []],
        [[2, "SaberAddDecimalsWithdraw"], []],
        [[3, "TokenSwap"], []],
        [[4, "Sencha"], []],
        [[5, "Step"], []],
        [[6, "Cropper"], []],
        [[7, "Raydium"], []],
        [[8, "Crema"], [{ name: "aToB", ...boolItem }]],
        [[9, "Lifinity"], []],
        [[10, "Mercurial"], []],
        [[11, "Cykura"], []],
        [[12, "Serum"], [{ name: "side", ...sideItem }]],
        [[13, "MarinadeDeposit"], []],
        [[14, "MarinadeUnstake"], []],
        [[15, "Aldrin"], [{ name: "side", ...sideItem }]],
        [[16, "AldrinV2"], [{ name: "side", ...sideItem }]],
        [[17, "Whirlpool"], [{ name: "aToB", ...boolItem }]],
        [[18, "Invariant"], [{ name: "xToY", ...boolItem }]],
        [[19, "Meteora"], []],
        [[20, "GooseFX"], []],
        [[21, "DeltaFi"], [{ name: "stable", ...boolItem }]],
        [[22, "Balansol"], []],
        [[23, "MarcoPolo"], [{ name: "xToY", ...boolItem }]],
        [[24, "Dradex"], [{ name: "side", ...sideItem }]],
        [[25, "LifinityV2"], []],
        [[26, "RaydiumClmm"], []],
        [[27, "Openbook"], [{ name: "side", ...sideItem }]],
        [[28, "Phoenix"], [{ name: "side", ...sideItem }]],
        // TODO: add more?
    ],
} as const satisfies SwitchLayoutItem;

const routePlanStep = [
    { name: "swap", ...swapItem },
    { name: "percent", binary: "uint", size: 1 },
    { name: "inputIndex", binary: "uint", size: 1 },
    { name: "outputIndex", binary: "uint", size: 1 },
] as const satisfies Layout;

export type AnchorSelector = [number, number, number, number, number, number, number, number];

export const selectorItem = (selector: AnchorSelector) =>
    ({
        name: "prefix",
        binary: "bytes",
        custom: Uint8Array.from(selector),
    }) as const;

const sharedAccountsRouteArgsLayout = [
    selectorItem([193, 32, 155, 51, 65, 214, 156, 129]),
    { name: "id", binary: "uint", size: 1 },
    {
        name: "routePlan",
        binary: "array",
        lengthSize: 4,
        lengthEndianness: "little",
        layout: routePlanStep,
    },
    { name: "inAmount", binary: "uint", size: 8, endianness: "little" },
    { name: "quotedOutAmount", binary: "uint", size: 8, endianness: "little" },
    { name: "slippageBps", binary: "uint", size: 2, endianness: "little" },
    { name: "platformFeeBps", binary: "uint", size: 1 },
] as const satisfies Layout;
