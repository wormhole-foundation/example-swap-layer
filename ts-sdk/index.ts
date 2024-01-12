import {
  LayoutToType,
  serializeLayout,
  deserializeLayout,
} from "@wormhole-foundation/sdk-base";

import {
  proxyConstructorArgsLayout,
  governanceCommandLayout,
  governanceCommandsBatchLayout,
  initiateArgsLayout,
  swapMessageLayout,
  feeParamsLayout,
  feeParamUpdateLayout,
  feeParamUpdatesBatchLayout,
  queryLayout,
  queriesBatchLayout,
} from "./layout";

export type ProxyConstructorArgs = LayoutToType<typeof proxyConstructorArgsLayout>;
export const encodeProxyConstructorArgs = (args: ProxyConstructorArgs): Uint8Array =>
  serializeLayout(proxyConstructorArgsLayout, args);

export type GovernanceCommand = LayoutToType<typeof governanceCommandLayout>;
export const encodeGovernanceCommandsBatch = (args: readonly GovernanceCommand[]): Uint8Array =>
  serializeLayout(governanceCommandsBatchLayout, args);

export type InitiateArgs = LayoutToType<typeof initiateArgsLayout>;
export const encodeInitiateArgs = (args: InitiateArgs): Uint8Array =>
  serializeLayout(initiateArgsLayout, args);

export type FeeParamUpdate = LayoutToType<typeof feeParamUpdateLayout>;
export const encodeFeeParamUpdatesBatch = (args: readonly FeeParamUpdate[]): Uint8Array =>
  serializeLayout(feeParamUpdatesBatchLayout, args);

//combine with adhoc layouts to deserialize return values
export type Query = LayoutToType<typeof queryLayout>;
export const encodeQueriesBatch = (args: readonly Query[]): Uint8Array =>
  serializeLayout(queriesBatchLayout, args);

export type SwapMessage = LayoutToType<typeof swapMessageLayout>;
export const deserializeSwapMessage = (data: Uint8Array): SwapMessage =>
  deserializeLayout(swapMessageLayout, data);

export type FeeParams = LayoutToType<typeof feeParamsLayout>;
export const deserializeFeeParams = (data: Uint8Array): FeeParams =>
  deserializeLayout(feeParamsLayout, data);
