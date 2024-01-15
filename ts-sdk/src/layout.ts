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

const forceBigIntConversion = {
  custom: {
    to: (val: number) => BigInt(val),
    from: (val: bigint) => Number(val),
  } satisfies CustomConversion<number, bigint>,
} as const;

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

const timestampItem = { binary: "uint", size:  4 } as const satisfies UintLayoutItem;
const amountItem    = { binary: "uint", size: 16 } as const satisfies UintLayoutItem;

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

const gasDropoffResolution = BigInt(1e6);
const gasDropoffItem = {
  binary: "uint",
  size: 4,
  custom: {
    to: (val: number): bigint => BigInt(val) * gasDropoffResolution,
    from: (price: bigint): number => Number(price / gasDropoffResolution),
  } as const satisfies CustomConversion<number, bigint>,
} as const satisfies UintLayoutItem;

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

const swapLayout = [
  //this will eventually be a switch - but for now we only have one type - uniswap
  { name: "type", binary: "uint", size: 1, custom: { to: "Uniswap", from: 1 }},
  { name: "limitAmount", ...amountItem },
  { name: "deadline", ...timestampItem },
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

//0.0abcd to ab.cd (or 100 %)
const percentageItem = {
  binary: "uint",
  size: 2,
  custom: {
    to: (val: number): number => (val>>2) / 10**(2 + (val % 4)),
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

const gasPriceResolution = BigInt(1e6);
const gasPriceItem = {
  binary: "uint",
  size: 4,
  custom: {
    to: (val: number): bigint => BigInt(val) * gasPriceResolution,
    from: (price: bigint): number => Number(price / gasPriceResolution),
  }
} as const satisfies UintLayoutItem;

const baseFeeItem = {
  binary: "uint",
  size: 4,
  ...forceBigIntConversion
} as const satisfies UintLayoutItem;

const gasTokenPriceItem = { binary: "uint", size: 10 } as const satisfies UintLayoutItem;

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

const gasPriceHackItem = {
  binary: "object",
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
    [[0, "GasPrice"],                [{ name: "value", ...gasPriceHackItem  }]],
    [[1, "GasTokenPrice"],           [{ name: "value", ...gasTokenPriceItem }]],
    [[2, "BaseFee"],                 [{ name: "value", ...baseFeeItem       }]],
    [[3, "GasPriceUpdateThreshold"], [{ name: "value", ...percentageItem    }]],
    [[4, "GasPriceMargin"],          [{ name: "value", ...percentageItem    }]],
    [[5, "GasDropoffMargin"],        [{ name: "value", ...percentageItem    }]],
    [[6, "MaxGasDropoff"],           [{ name: "value", ...gasDropoffItem    }]],
  ],
} as const satisfies LayoutItem;

export const feeParamUpdateLayout = [
  { name: "chain", ...layoutItems.chainItem() },
  { name: "update", ... feeParamUpdateItem },
] as const satisfies Layout;

export const feeParamUpdatesBatchLayout = {
  binary: "array",
  layout: feeParamUpdateLayout,
} as const satisfies Layout;

const immutableTypes = [
  "Wormhole",
  "Usdc",
  "Weth",
  "Permit2",
  "UniswapV3Router",
  "LiquidityLayer",
  "MajorDelay",
  "MinorDelay"
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

const subQueries = ["Current", "Proposed", "UnlockTime"] as const;
type SubQuery = typeof subQueries[number];
const subQueryTypeItem = {
  binary: "uint",
  size: 1,
  custom: {
    to: (val: number) => {
      if (val >= subQueries.length)
        throw new Error("Invalid subquery type");

      return subQueries[val];
    },
    from: (val: SubQuery): number => subQueries.indexOf(val),
  }
} as const satisfies UintLayoutItem;

export const queryLayout = {
  binary: "switch",
  idSize: 1,
  idTag: "query",
  layouts: [
    //TODO define remaining GovernanceCommand types
    [[0, "FeeParams"],               [{ name: "chain", ...layoutItems.chainItem() }]],
    [[1, "Endpoint"],                [
                                      { name: "subQuery", ...subQueryTypeItem },
                                      { name: "chain",    ...layoutItems.chainItem() }
                                     ]],
    [[2, "Immutable"],               [{ name: "immutable", ...immutableTypeItem }]],
    [[3, "AdminCanUpgradeContract"], []],
    [[4, "Assistant"],               []],
    [[5, "Owner"],                   [{ name: "subQuery", ...subQueryTypeItem }]],
    [[6, "Admin"],                   [{ name: "subQuery", ...subQueryTypeItem }]],
    [[7, "FeeRecipient"],            [{ name: "subQuery", ...subQueryTypeItem }]],
    [[8, "Implementation"],          [{ name: "subQuery", ...subQueryTypeItem }]],
  ],
} as const satisfies LayoutItem;

export const queriesBatchLayout = {
  binary: "array",
  layout: queryLayout,
} as const satisfies Layout;

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
    [[0, "UpdateEndpoint"],         [{ name: "endpoint", ...addressChainItem },
                                      ...feeParamsLayout,
                                    ]],
    [[1, "ProposeEndpointUpdate"],  [{ name: "endpoint", ...addressChainItem }]],
    [[6, "UpgradeContract"],        [{ name: "implementation", ...evmAddressItem }]],
    [[7, "ProposeContractUpgrade"], [{ name: "implementation", ...evmAddressItem }]],
  ],
} as const satisfies Layout;

export const governanceCommandsBatchLayout = {
  binary: "array",
  layout: governanceCommandLayout,
} as const satisfies Layout;
