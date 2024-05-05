// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

//integration guideline:
// *  on-chain: use SwapLayerIntegration.sol base contract
// * off-chain: use TypeScript SDK to compose calls
interface ISwapLayer {
  //selector: 0f3376b1
  function initiate(
    uint16 targetChain,
    bytes32 recipient, //must be the redeemer in case of a custom payload
    bytes calldata params
  ) external payable returns (bytes memory);

  //selector: 2e14075e
  function redeem(
    uint8 attestationType, //AttestationType enum value
    bytes calldata attestation,
    bytes calldata params
  ) external payable returns (bytes memory);

  //selector: 64ee4476
  function batchQueries(bytes calldata queries) external view returns (bytes memory);

  //selector: 9efc05ce
  function batchFeeUpdates(bytes calldata updates) external;

  //selector: a9bb3dca
  function batchGovernanceCommands(bytes calldata commands) external;

  //selector: f4189c473 - can't actually be called externally except by the contract itself
  function checkedUpgrade(bytes calldata data) external payable;

  //required for _wnative.withdraw (= IWETH.withdraw)
  receive() external payable;
}