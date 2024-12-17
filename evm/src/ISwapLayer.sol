// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;


import { OrderResponse } from "liquidity-layer/interfaces/ITokenRouter.sol";

//integration guideline:
// *  on-chain: use SwapLayerIntegration.sol base contract
// * off-chain: use TypeScript SDK to compose calls and decode returned bytes
interface ISwapLayer {
  //selector: 0f3376b1
  function initiate(
    bytes32 recipient, //must be the redeemer in case of a custom payload
    uint256 overrideAmountIn,
    uint16 targetChain,
    bytes calldata params
  ) external payable returns (bytes memory);

  //selector: 604009a9 (redeem(bytes,(bytes,bytes,bytes)))
  function redeem(
    bytes calldata params,
    OrderResponse calldata attestations
  ) external payable returns (bytes memory);

  //selector: 64ee4476
  function batchQueries(bytes calldata queries) external view returns (bytes memory);

  //selector: 9efc05ce
  function batchFeeUpdates(bytes calldata updates) external;

  //selector: a9bb3dca
  function batchGovernanceCommands(bytes calldata commands) external;

  //selector: c97166c7
  function batchMaxApprove(bytes calldata approvals) external;

  //selector: f4189c473 - can't actually be called externally except by the contract itself
  function checkedUpgrade(bytes calldata data) external payable;

  //required for _wnative.withdraw (= IWETH.withdraw)
  receive() external payable;
}