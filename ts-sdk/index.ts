import {
  LayoutToType,
  serializeLayout,
  deserializeLayout,
} from "@wormhole-foundation/sdk-base";

import {
  proxyConstructorArgsLayout,
  governanceCommandLayout,
  governanceCommandsBatchLayout,
  swapMessageLayout,
} from "./layout";

export type ProxyConstructorArgs = LayoutToType<typeof proxyConstructorArgsLayout>;
export const encodeProxyConstructorArgs = (args: ProxyConstructorArgs): Uint8Array =>
  serializeLayout(proxyConstructorArgsLayout, args);

export type GovernanceCommand = LayoutToType<typeof governanceCommandLayout>;
export const encodeGovernanceCommandsBatch = (args: readonly GovernanceCommand[]): Uint8Array =>
  serializeLayout(governanceCommandsBatchLayout, args);

export type SwapMessage = LayoutToType<typeof swapMessageLayout>;
export const deserializeSwapMessage = (data: Uint8Array): SwapMessage =>
  deserializeLayout(swapMessageLayout, data);