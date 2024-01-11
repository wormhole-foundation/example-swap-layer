// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import { OrderResponse } from "liquidity-layer/ITokenRouter.sol";

interface ISwapLayer {
  //selector: 22bf2bd8
  function initiate(
    uint16 targetChain,
    bytes32 recipient, //must be the redeemer in case of a custom payload
    bool isExactIn,
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

  //selector: e60df1a0
  function batchOwnerInterventions(bytes calldata interventions) external;

  //selector: f4189c473 - can't actually be called externally except by the contract itself
  function checkedUpgrade(bytes calldata data) external payable;

  //required for weth.withdraw
  receive() external payable;
}