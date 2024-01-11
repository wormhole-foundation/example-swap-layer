import {
  Layout,
  CustomConversion,
  LayoutItem,
  NamedLayoutItem,
  UintLayoutItem,
  FixedSizeBytesLayoutItem,
} from "@wormhole-foundation/sdk-base";
import { layoutItems } from "@wormhole-foundation/sdk-definitions"
import { EvmAddress } from "@wormhole-foundation/connect-sdk-evm";

//I can't believe I forgot to implement this!
const boolItem = {
  binary: "uint",
  size: 1,
  custom: {
    to: (val: number): boolean => val > 0,
    from: (val: boolean): number => val ? 1 : 0,
  } satisfies CustomConversion<number, boolean>,
} as const satisfies UintLayoutItem;

const evmAddressItem = {
  binary: "bytes",
  size: 20,
  custom: {
    to: (val: Uint8Array): string => new EvmAddress(val).toString(),
    from: (val: string): Uint8Array => new EvmAddress(val).toUint8Array(),
  } satisfies CustomConversion<Uint8Array, string>,
} as const satisfies FixedSizeBytesLayoutItem;

//TODO from payload/relayer - should be moved to layoutItems
const addressChainItem = {
  binary: "object",
  layout: [
    { name: "chain", ...layoutItems.chainItem() },
    { name: "address", ...layoutItems.universalAddressItem },
  ],
} as const satisfies LayoutItem;

export const proxyConstructorArgsLayout = [
  { name: "owner", ...evmAddressItem },
  { name: "admin", ...evmAddressItem },
  { name: "assistant", ...evmAddressItem },
  { name: "feeRecipient", ...evmAddressItem },
  { name: "adminCanUpgrade", ...boolItem },
] as const satisfies Layout;

export const governanceCommandLayout = {
  binary: "switch",
  idSize: 1,
  idTag: "GovernanceCommand",
  layouts: [
    //TODO define remaining GovernanceCommand types
    [[0, "UpdateEndpoint"], [{ name: "endpoint", ...addressChainItem }]],
    [[1, "ProposeEndpointUpdate"], [{ name: "endpoint", ...addressChainItem }]],
    [[6, "UpgradeContract"], [{ name: "implementation", ...evmAddressItem }]],
    [[7, "ProposeContractUpgrade"], [{ name: "implementation", ...evmAddressItem }]],
  ],
} as const satisfies Layout;

export const governanceCommandsBatchLayout = {
  binary: "array",
  layout: governanceCommandLayout,
} as const satisfies Layout;

const deadlineItem = {
  name: "deadline",
  binary: "uint",
  size: 4
} as const satisfies NamedLayoutItem;

const amountItem = { binary: "uint", size: 16 } as const satisfies UintLayoutItem;

const fastTransferModeItem = {
  name: "fastTransferMode",
  binary: "switch",
  idSize: 1,
  idTag: "mode",
  layouts: [
    [[0, "Disabled"], []],
    [[1, "Enabled"], [
      { name: "maxFee", binary: "uint", size: 6, /*todo max fee conversion*/ },
      deadlineItem,
    ]],
  ]
} as const satisfies NamedLayoutItem;

const redeemModeItem = {
  name: "redeemMode",
  binary: "switch",
  idSize: 1,
  idTag: "mode",
  layouts: [
    [[0, "Direct"], []],
    [[1, "Payload"], [{ name: "payload", binary: "bytes", lengthSize: 4 }]],
    [[2, "Relay"], [
      { name: "gasDropoff", binary: "uint", size: 4, /*todo gas dropoff conversion*/ },
      { name: "relayerFee", binary: "uint", size: 6, /*todo relayer fee conversion*/ }
    ]],
  ]
} as const satisfies NamedLayoutItem;

const acquireModeItem = {
  name: "acquireMode",
  binary: "switch",
  idSize: 1,
  idTag: "mode",
  layouts: [
    [[0, "Preapproved"], []],
    [[1, "Permit"], [
      { name: "value", binary: "uint", size: 32 },
      { name: "deadline", binary: "uint", size: 32 },
      { name: "signature", binary: "bytes", size: 65 },
    ]],
    [[2, "Permit2Permit"], [
      { name: "amount", binary: "uint", size: 20 },
      { name: "expiration", binary: "uint", size: 6 },
      { name: "nonce", binary: "uint", size: 6 },
      { name: "sigDeadline", binary: "uint", size: 32 },
      { name: "signature", binary: "bytes", size: 65 },
    ]],
    [[3, "Permit2Transfer"], [
      { name: "amount", binary: "uint", size: 32 },
      { name: "nonce", binary: "uint", size: 32 },
      { name: "sigDeadline", binary: "uint", size: 32 },
      { name: "signature", binary: "bytes", size: 65 },
    ]],
  ]
} as const satisfies NamedLayoutItem;

export const swapLayout = [
  //this will eventually be a switch - but for now we only have one type - uniswap
  { name: "type", binary: "uint", size: 1, custom: { to: "Uniswap", from: 1 }},
  { name: "limitAmount", ...amountItem },
  deadlineItem,
  { name: "legFirstFee", binary: "uint", size: 3 },
  { name: "path", binary: "array", lengthSize: 1, layout: [
    { name: "address", ...evmAddressItem },
    { name: "fee", binary: "uint", size: 3 },
  ]},
] as const satisfies Layout;

const outputTokenItem = {
  name: "outputToken",
  binary: "switch",
  idSize: 1,
  idTag: "type",
  layouts: [
    [[0, "Usdc"], []],
    [[1, "Gas"], [
      { name: "swap", binary: "object", layout: swapLayout}
    ]],
    [[2, "Other"], [
      { name: "address", ...layoutItems.universalAddressItem},
      { name: "swap", binary: "object", layout: swapLayout},
    ]],
  ]
} as const satisfies NamedLayoutItem;

const inputTokenItem = {
  name: "inputToken",
  binary: "switch",
  idSize: 1,
  idTag: "type",
  layouts: [
    [[0, "Usdc"], [
      acquireModeItem,
      { name: "amount", ...amountItem },
    ]],
    [[1, "Gas"], [
      { name: "swap", binary: "object", layout: swapLayout}
    ]],
    [[2, "Other"], [
      acquireModeItem,
      { name: "approveCheck", ...boolItem},
      { name: "address", ...evmAddressItem},
      { name: "amount", ...amountItem },
      { name: "swap", binary: "object", layout: swapLayout},
    ]],
  ]
} as const satisfies NamedLayoutItem;

export const initiateArgsLayout = [
  fastTransferModeItem,
  redeemModeItem,
  outputTokenItem,
  inputTokenItem,
] as const satisfies Layout;

export const swapMessageLayout = [
  { name: "version", binary: "uint", size: 1, custom: 1, omit: true },
  { name: "recipient", ...layoutItems.universalAddressItem },
  redeemModeItem,
  outputTokenItem,
] as const satisfies Layout;
