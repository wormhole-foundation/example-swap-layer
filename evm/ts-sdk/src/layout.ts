import {
  Layout,
  CustomConversion,
  LayoutItem,
  NamedLayoutItem,
  UintLayoutItem,
  BytesLayoutItem,
} from "@wormhole-foundation/sdk-base";
import { layoutItems } from "@wormhole-foundation/sdk-definitions"
import { EvmAddress } from "@wormhole-foundation/sdk-evm";

// ---- basic types ----

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
    from: (val: boolean): number => val ? 1 : 0,
  } satisfies CustomConversion<number, boolean>,
} as const satisfies UintLayoutItem;

const evmAddressItem = {
  binary: "bytes",
  size: 20,
  custom: {
    to: (encoded: Uint8Array): string => new EvmAddress(encoded).toString(),
    from: (addr: string): Uint8Array => new EvmAddress(addr).toUint8Array(),
  } satisfies CustomConversion<Uint8Array, string>,
} as const satisfies BytesLayoutItem;

//TODO from payload/relayer - should be moved to layoutItems
const addressChainItem = {
  binary: "bytes",
  layout: [
    { name: "chain", ...layoutItems.chainItem() },
    { name: "address", ...layoutItems.universalAddressItem },
  ],
} as const satisfies LayoutItem;

const timestampItem = { binary: "uint", size:  4 } as const satisfies UintLayoutItem;
const amountItem    = { binary: "uint", size: 16 } as const satisfies UintLayoutItem;

// ---- fee param types ----

const baseFeeItem = {
  binary: "uint",
  size: 4,
  ...forceBigIntConversion
} as const satisfies UintLayoutItem;

const gasPriceUnit = BigInt(1e6); //must match the constant defined in GasPrice.sol!
const gasPriceItem = {
  binary: "uint",
  size: 4,
  custom: {
    to: (val: number): bigint => BigInt(val) * gasPriceUnit,
    from: (price: bigint): number => Number(price / gasPriceUnit),
  }
} as const satisfies UintLayoutItem;

const gasDropoffUnit = BigInt(1e12); //must match the constant defined in GasDropoff.sol!
const gasDropoffItem = {
  binary: "uint",
  size: 4,
  custom: {
    to: (encoded: number): bigint => BigInt(encoded) * gasDropoffUnit,
    from: (dropoff: bigint): number => Number(dropoff / gasDropoffUnit),
  } as const satisfies CustomConversion<number, bigint>,
} as const satisfies UintLayoutItem;

//reflects Percentage.sol, models percentage values with a range from 0.0abcd to ab.cd (or 100 %)
const percentageItem = {
  binary: "uint",
  size: 2,
  custom: {
    to: (encoded: number): number => (encoded>>2) / 10**(2 + (encoded % 4)),
    from: (percentage: number): number => {
      if (percentage > 100 || percentage < 0)
        throw new Error("Percentage must be between 0 and 100");

      if (percentage < 1e-5)
        return 0;

      let negexp = Math.min(3, Math.floor(-Math.log10(percentage)) + 2);
      let mantissa = Math.round(percentage * 10**(2 + negexp));
      while (mantissa % 10 == 0 && negexp > 0) {
        mantissa /= 10;
        --negexp;
      }
      return (mantissa << 2) + negexp;
    }
  } satisfies CustomConversion<number, number>,
} as const satisfies UintLayoutItem;

const gasTokenPriceItem = { binary: "uint", size: 10 } as const satisfies UintLayoutItem;

//this layout reflects the FeeParams type in SwapLayerRelayingFees.sol which uses a packed layout
//  to fit into a single storage slot
export const feeParamsLayout = [
  { name: "baseFee",                 ...baseFeeItem       },
  { name: "gasPrice",                ...gasPriceItem      },
  { name: "gasPriceMargin",          ...percentageItem    },
  { name: "gasPriceTimestamp",       ...timestampItem     },
  { name: "gasPriceUpdateThreshold", ...percentageItem    },
  { name: "maxGasDropoff",           ...gasDropoffItem    },
  { name: "gasDropoffMargin",        ...percentageItem    },
  { name: "gasTokenPrice",           ...gasTokenPriceItem },
] as const satisfies Layout;

// ---- initiate params ----

const fastTransferModeItem = {
  name: "fastTransferMode",
  binary: "switch",
  idSize: 1,
  idTag: "mode",
  layouts: [
    [[0, "Disabled"], []],
    [[1, "Enabled"], [
      { name: "maxFee", binary: "uint", size: 6, ...forceBigIntConversion }, //atomic usdc
      { name: "deadline", ...timestampItem }, //according to block timestamp
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
      { name: "gasDropoff", ...gasDropoffItem },
      { name: "maxRelayingFee", binary: "uint", size: 6, ...forceBigIntConversion },
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
      { name: "value",       binary: "uint",  size: 32 },
      { name: "deadline",    binary: "uint",  size: 32 },
      { name: "signature",   binary: "bytes", size: 65 },
    ]],
    [[2, "Permit2Permit"], [
      { name: "amount",      binary: "uint",  size: 20 },
      { name: "expiration",  binary: "uint",  size:  6 },
      { name: "nonce",       binary: "uint",  size:  6 },
      { name: "sigDeadline", binary: "uint",  size: 32 },
      { name: "signature",   binary: "bytes", size: 65 },
    ]],
    [[3, "Permit2Transfer"], [
      { name: "amount",      binary: "uint",  size: 32 },
      { name: "nonce",       binary: "uint",  size: 32 },
      { name: "sigDeadline", binary: "uint",  size: 32 },
      { name: "signature",   binary: "bytes", size: 65 },
    ]],
  ]
} as const satisfies NamedLayoutItem;

const sharedUniswapTraderJoeLayout = [
  { name: "legFirstFee", binary: "uint", size: 3 },
  { name: "path", binary: "array", lengthSize: 1, layout: [
    { name: "address", ...evmAddressItem },
    { name: "fee", binary: "uint", size: 3 },
  ]}
] as const satisfies Layout;

const swapItem = {
  name: "swap",
  binary: "bytes",
  layout: [
    { name: "deadline", ...timestampItem },
    { name: "limitAmount", ...amountItem },
    { name: "type", binary: "switch", idSize: 1, layouts: [
      [[1, "UniswapV3"], sharedUniswapTraderJoeLayout],
      [[2, "TraderJoe"], sharedUniswapTraderJoeLayout],
      [[16, "GenericSolana"], [/* TODO */]]
    ]},
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
      swapItem
    ]],
    [[2, "Other"], [
      acquireModeItem,
      { name: "approveCheck", ...boolItem       },
      { name: "address",      ...evmAddressItem },
      { name: "amount",       ...amountItem     },
      swapItem,
    ]],
  ]
} as const satisfies NamedLayoutItem;

const outputTokenItem = {
  name: "outputToken",
  binary: "switch",
  idSize: 1,
  idTag: "type",
  layouts: [
    [[0, "Usdc"],  []],
    [[1, "Gas"],   [swapItem]],
    [[2, "Other"], [{ name: "address", ...layoutItems.universalAddressItem},
                    swapItem,
                   ]],
  ]
} as const satisfies NamedLayoutItem;

export const initiateArgsLayout = [
  fastTransferModeItem,
  redeemModeItem,
  { name: "isExactIn", ...boolItem },
  inputTokenItem,
  outputTokenItem,
] as const satisfies Layout;

// ---- message layout ----

export const swapMessageLayout = [
  { name: "version", binary: "uint", size: 1, custom: 1, omit: true },
  { name: "recipient", ...layoutItems.universalAddressItem },
  redeemModeItem,
  outputTokenItem,
] as const satisfies Layout;

// ---- query types ----

const immutableTypes = [
  "Wormhole",
  "Usdc",
  "Weth",
  "Permit2",
  "UniswapRouter",
  "LiquidityLayer",
] as const;
type ImmutableType = typeof immutableTypes[number];
const immutableTypeItem = {
  binary: "uint",
  size: 1,
  custom: {
    to: (val: number) => {
      if (val >= immutableTypes.length)
        throw new Error("Invalid immutable type");

      return immutableTypes[val];
    },
    from: (val: ImmutableType): number => immutableTypes.indexOf(val),
  }
} as const satisfies UintLayoutItem;

export const queryLayout = {
  binary: "switch",
  idSize: 1,
  idTag: "query",
  layouts: [
    [[0, "FeeParams"],            [{ name: "chain", ...layoutItems.chainItem() }]],
    [[1, "Peer"],                 [{ name: "chain", ...layoutItems.chainItem() }]],
    [[2, "Immutable"],            [{ name: "immutable", ...immutableTypeItem   }]],
    [[3, "AssistantIsEmpowered"], []],
    [[4, "Owner"],                []],
    [[5, "PendingOwner"],         []],
    [[6, "Assistant"],            []],
    [[7, "FeeUpdater"],           []],
    [[8, "FeeRecipient"],         []],
    [[9, "Implementation"],       []],
  ],
} as const satisfies LayoutItem;

export const queriesBatchLayout = {
  binary: "array",
  layout: queryLayout,
} as const satisfies Layout;

// ---- governance types ----

const timestampedGasPriceItem = {
  binary: "bytes",
  layout: [
    { name: "gasPriceTimestamp", ...timestampItem },
    { name: "gasPrice",          ...gasPriceItem  },
  ],
} as const satisfies LayoutItem;

export const feeParamUpdateItem = {
  binary: "switch",
  idSize: 1,
  idTag: "param",
  layouts: [
    [[0, "GasPrice"],                [{ name: "value", ...timestampedGasPriceItem }]],
    [[1, "GasTokenPrice"],           [{ name: "value", ...gasTokenPriceItem       }]],
    [[2, "BaseFee"],                 [{ name: "value", ...baseFeeItem             }]],
    [[3, "GasPriceUpdateThreshold"], [{ name: "value", ...percentageItem          }]],
    [[4, "GasPriceMargin"],          [{ name: "value", ...percentageItem          }]],
    [[5, "GasDropoffMargin"],        [{ name: "value", ...percentageItem          }]],
    [[6, "MaxGasDropoff"],           [{ name: "value", ...gasDropoffItem          }]],
  ],
} as const satisfies LayoutItem;

export const feeParamUpdateLayout = [
  { name: "chain",  ...layoutItems.chainItem() },
  { name: "update", ...feeParamUpdateItem      },
] as const satisfies Layout;

export const feeParamUpdatesBatchLayout = {
  binary: "array",
  layout: feeParamUpdateLayout,
} as const satisfies Layout;

export const proxyConstructorArgsLayout = [
  { name: "owner",                ...evmAddressItem },
  { name: "assistant",            ...evmAddressItem },
  { name: "feeUpdater",           ...evmAddressItem },
  { name: "feeRecipient",         ...evmAddressItem },
  { name: "assistantIsEmpowered", ...boolItem       },
] as const satisfies Layout;

export const governanceCommandLayout = {
  binary: "switch",
  idSize: 1,
  idTag: "GovernanceCommand",
  layouts: [
    [[0, "UpdatePeer"],               [{ name: "peer", ...addressChainItem },
                                        ...feeParamsLayout,
                                      ]],
    [[1, "SweepTokens"],              [{ name: "token",           ...evmAddressItem }]],
    [[2, "UpdateFeeUpdater"],         [{ name: "newFeeUpdater",   ...evmAddressItem }]],
    [[3, "UpdateAssistant"],          [{ name: "newAssistant",    ...evmAddressItem }]],
    [[4, "DisempowerAssistant"],      []],
    [[5, "UpdateFeeRecipient"],       [{ name: "newFeeRecipient", ...evmAddressItem }]],
    [[6, "UpgradeContract"],          [{ name: "implementation",  ...evmAddressItem }]],
    [[7, "EmpowerAssistant"],         []],
    [[8, "ProposeOwnershipTransfer"], [{ name: "pendingOwner",    ...evmAddressItem }]],
    [[9, "RelinquishOwnership"],      []],
  ],
} as const satisfies Layout;

export const governanceCommandsBatchLayout = {
  binary: "array",
  layout: governanceCommandLayout,
} as const satisfies Layout;
