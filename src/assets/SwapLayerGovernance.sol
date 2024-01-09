// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import { ProxyBase } from "proxy/ProxyBase.sol";

import "./SwapLayerBase.sol";

struct GovernanceState {
  address owner;
  address pendingOwner;
  address assistant;
  address feeRecipient;
}

// we use the designated eip1967 admin storage slot: keccak256("eip1967.proxy.admin") - 1
bytes32 constant GOVERNANCE_STORAGE_SLOT =
  0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

function governanceState() pure returns (GovernanceState storage state) {
  assembly ("memory-safe") { state.slot := GOVERNANCE_STORAGE_SLOT }
}

error NotAuthorized();
error InvalidOwner();
error InvalidFeeRecipient();

event OwnershipTransfered(address oldOwner, address newOwner);
event AssistantUpdated(address oldAssistant, address newAssistant);
event FeeRecipientUpdated(address oldRecipient, address newRecipient);
event EndpointRegistered(uint16 indexed chainId, bytes32 endpoint);

enum GovernanceAction {
  RegisterEndpoint,
  SweepTokens,
  UpdateAssistant,
  UpdateFeeRecipient,
  UpgradeContract,
  ProposeOwnershipTransfer
}

abstract contract SwapLayerGovernance is SwapLayerBase, ProxyBase {
  using BytesParsing for bytes;

  modifier onlyAssistantOrOwner() {
    GovernanceState storage state = governanceState();
    if (msg.sender != state.assistant && msg.sender != state.owner)
      revert NotAuthorized();
    
    _;
  }

  //selector: d78b3c6e
  function executeGovernanceActions(bytes calldata actions) external {
    GovernanceState storage state = governanceState();
    if (msg.sender != state.owner) {
      if (msg.sender == state.pendingOwner)
        _confirmOwnershipTransfer();
      else
        revert NotAuthorized();
    }
    
    uint offset = 0;
    while (offset < actions.length) {
      uint8 _action;
      (_action, offset) = actions.asUint8Unchecked(offset);
      GovernanceAction action = GovernanceAction(_action);
      if (action == GovernanceAction.RegisterEndpoint)
        offset = _registerEndpoint(actions, offset);
      else if (action == GovernanceAction.UpdateAssistant)
        offset = _updateAssistant(actions, offset);
      else if (action == GovernanceAction.SweepTokens)
        offset = _sweepTokens(actions, offset);
      else if (action == GovernanceAction.UpdateFeeRecipient)
        offset = _updateFeeRecipient(actions, offset);
      else if (action == GovernanceAction.UpgradeContract)
        offset = _upgradeContract(actions, offset);
      else //must be GovernanceAction.ProposeOwnershipTransfer
        offset = _proposeOwnershipTransfer(actions, offset);
    }
    actions.checkLength(offset);
  }

  function _governanceConstruction(
    address owner,
    address assistant,
    address feeRecipient
  ) internal {
    if (owner == address(0))
      revert InvalidOwner();
    
    if (feeRecipient == address(0))
      revert InvalidFeeRecipient();
    
    GovernanceState storage state = governanceState();
    assert(state.owner == address(0));
    state.owner = owner;
    state.assistant = assistant;
    state.feeRecipient = feeRecipient;
  }

  function _getOwner() internal view returns (address) {
    return governanceState().owner;
  }

  function _getPendingOwner() internal view returns (address) {
    return governanceState().pendingOwner;
  }

  function _getAssistant() internal view returns (address) {
    return governanceState().assistant;
  }

  function _getFeeRecipient() internal view returns (address) {
    return governanceState().feeRecipient;
  }

  // ---- private ----

  function _registerEndpoint(bytes calldata actions, uint offset) private returns (uint) {
    uint16 endpointChain;
    bytes32 endpointAddress;
    (endpointChain,   offset) = actions.asUint16Unchecked(offset);
    (endpointAddress, offset) = actions.asBytes32Unchecked(offset);

    _setEndpoint(endpointChain, endpointAddress);
    emit EndpointRegistered(endpointChain, endpointAddress);
    
    return offset;
  }

  function _updateAssistant(bytes calldata actions, uint offset) private returns (uint) {
    GovernanceState storage state = governanceState();
    
    address newAssistant;
    (newAssistant, offset) = actions.asAddressUnchecked(offset);

    state.assistant = newAssistant;
    emit AssistantUpdated(state.assistant, newAssistant);

    return offset;
  }

  function _updateFeeRecipient(bytes calldata actions, uint offset) private returns (uint) {
    GovernanceState storage state = governanceState();

    address newFeeRecipient;
    (newFeeRecipient, offset) = actions.asAddressUnchecked(offset);
    if (newFeeRecipient == address(0))
      revert InvalidFeeRecipient();

    state.feeRecipient = newFeeRecipient;
    emit FeeRecipientUpdated(state.feeRecipient, newFeeRecipient);

    return offset;
  }

  function _sweepTokens(bytes calldata actions, uint offset) private returns (uint) {
    address token;
    (token, offset) = actions.asAddressUnchecked(offset);
    if (token == address(0))
      _transferEth(msg.sender, address(this).balance);
    else
      IERC20(token).transfer(msg.sender, IERC20(token).balanceOf(address(this)));

    return offset;
  }

  function _upgradeContract(bytes calldata actions, uint offset) private returns (uint) {
    address newImplementation;
    (newImplementation, offset) = actions.asAddressUnchecked(offset);
    //contract upgrades must be the last action in the batch
    actions.checkLength(offset);

    _upgradeTo(newImplementation, new bytes(0));
    
    return offset;
  }

  function _proposeOwnershipTransfer(bytes calldata actions, uint offset) private returns (uint) {
    address newOwner;
    (newOwner, offset) = actions.asAddressUnchecked(offset);
    governanceState().pendingOwner = newOwner;

    return offset;
  }

  function _confirmOwnershipTransfer() private {
    GovernanceState storage state = governanceState();
    if (msg.sender != state.pendingOwner)
      revert NotAuthorized();

    emit OwnershipTransfered(state.owner, msg.sender);

    state.owner = msg.sender;
    state.pendingOwner = address(0);
  }
}
