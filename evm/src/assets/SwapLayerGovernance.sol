// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "@openzeppelin/token/ERC20/IERC20.sol";
import "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

import { ProxyBase } from "wormhole-sdk/proxy/ProxyBase.sol";
import "wormhole-sdk/libraries/BytesParsing.sol";

import { FeeParams, FeeParamsLib, SwapLayerRelayingFees } from "./SwapLayerRelayingFees.sol";

//rationale for different roles (owner, assistant, feeUpdater):
// * owner should be a mulit-sig / ultra cold wallet that is only activated in exceptional
//     circumstances.
// * assistant should also be either a cold wallet or Assistant contract. In either case,
//     the expectation is that multiple, slightly less trustworthy parties than the owner will
//     have access to it, lowering trust assumptions and increasing attack surface. Assistants
//     perform rare but not exceptional operations like registering new peers, etc.
// * feeUpdater is a hot wallet that is used to update fee parameters and the like.

struct GovernanceState {
  address  owner; //puts owner address in eip1967 admin slot
  address  pendingOwner;
  address  assistant;
  address  feeUpdater;
  address  feeRecipient;
  bool     assistantIsEmpowered;
}

// we use the designated eip1967 admin storage slot: keccak256("eip1967.proxy.admin") - 1
bytes32 constant GOVERNANCE_STORAGE_SLOT =
  0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

function governanceState() pure returns (GovernanceState storage state) {
  assembly ("memory-safe") { state.slot := GOVERNANCE_STORAGE_SLOT }
}

error NotAuthorized();
error InvalidFeeRecipient();

enum Role {
  Owner,
  Assistant,
  FeeUpdater,
  FeeRecipient
}

enum GovernanceCommand {
  //assistant can add new peers, but only empowered assistant can change existing registrations
  UpdatePeer,
  SweepTokens,
  UpdateFeeUpdater,
  UpdateAssistant,
  DisempowerAssistant,
  //only available to assistant when empowered:
  UpdateFeeRecipient,
  UpgradeContract,
  //only available to owner:
  EmpowerAssistant,
  ProposeOwnershipTransfer,
  RelinquishOwnership
}

event RoleUpdated(Role role, address oldAddress, address newAddress, uint256 timestamp);

abstract contract SwapLayerGovernance is SwapLayerRelayingFees, ProxyBase {
  using BytesParsing for bytes;
  using SafeERC20 for IERC20;

  // ---- construction ----

  function _governanceConstruction(
    address owner,
    address assistant,
    address feeUpdater,
    address feeRecipient,
    bool    assistantIsEmpowered
  ) internal {
    if (feeRecipient == address(0))
      revert InvalidFeeRecipient();

    GovernanceState storage state = governanceState();
    state.owner          = owner;
    state.assistant      = assistant;
    state.feeUpdater     = feeUpdater;
    state.feeRecipient   = feeRecipient;
    state.assistantIsEmpowered = assistantIsEmpowered;
  }

  // ---- externals ----

  //selector: 9efc05ce
  function batchFeeUpdates(bytes memory updates) external {
    GovernanceState storage state = governanceState();
    if (msg.sender != state.feeUpdater &&
        msg.sender != state.assistant &&
        msg.sender != state.owner)
      revert NotAuthorized();

    _batchFeeUpdates(updates);
  }

  //selector: a9bb3dca
  function batchGovernanceCommands(bytes calldata commands) external {
    GovernanceState storage state = governanceState();
    bool isOwner;
    if (msg.sender == state.owner) //check highest privilege level first
      isOwner = true;
    else if (msg.sender == state.assistant)
      isOwner = false;
    else if (msg.sender == state.pendingOwner) {
      _updateRole(Role.Owner, msg.sender);
      isOwner = true;
    }
    else
      revert NotAuthorized();

    uint offset = 0;
    while (offset < commands.length) {
      uint8 command_;
      (command_, offset) = commands.asUint8Unchecked(offset);
      GovernanceCommand command = GovernanceCommand(command_);
      if (command == GovernanceCommand.UpdatePeer) {
        uint16 peerChain;
        bytes32 newPeer;
        (peerChain, offset) = commands.asUint16Unchecked(offset);
        (newPeer,   offset) = commands.asBytes32Unchecked(offset);
        bytes32 curPeer = _getPeer(peerChain);
        if (newPeer != curPeer) {
          if (curPeer != bytes32(0) && !isOwner && !state.assistantIsEmpowered)
            revert NotAuthorized();

          _setPeer(peerChain, newPeer);
        }

        uint256 feeParams_;
        (feeParams_, offset) = commands.asUint256Unchecked(offset);
        FeeParams feeParams =
          newPeer == bytes32(0)
          ? FeeParams.wrap(0)
          : FeeParamsLib.checkedWrap(feeParams_);
        _setFeeParams(peerChain, feeParams);
      }
      else if (command == GovernanceCommand.SweepTokens) {
        address token;
        (token, offset) = commands.asAddressUnchecked(offset);

        if (token == address(0))
          _transferEth(msg.sender, address(this).balance);
        else
          IERC20(token).safeTransfer(msg.sender, IERC20(token).balanceOf(address(this)));
      }
      else if (command == GovernanceCommand.UpdateFeeUpdater) {
        address newFeeUpdater;
        (newFeeUpdater, offset) = commands.asAddressUnchecked(offset);
        _updateRole(Role.FeeUpdater, newFeeUpdater);
      }
      else if (command == GovernanceCommand.UpdateAssistant) {
        address newAssistant;
        (newAssistant, offset) = commands.asAddressUnchecked(offset);
        _updateRole(Role.Assistant, newAssistant);
      }
      else if (command == GovernanceCommand.DisempowerAssistant)
        state.assistantIsEmpowered = false;
      else { //owner or empowered assistant only commands
        if (!isOwner && !state.assistantIsEmpowered)
          revert NotAuthorized();

        if (command == GovernanceCommand.UpdateFeeRecipient) {
          address newFeeRecipient;
          (newFeeRecipient, offset) = commands.asAddressUnchecked(offset);
          _updateRole(Role.FeeRecipient, newFeeRecipient);
        }
        else if (command == GovernanceCommand.UpgradeContract) {
          address newImplementation;
          (newImplementation, offset) = commands.asAddressUnchecked(offset);
          //contract upgrades must be the last command in the batch
          commands.checkLength(offset);

          _upgradeTo(newImplementation, new bytes(0));
        }
        else { //owner only commands
          if (!isOwner)
            revert NotAuthorized();

          if (command == GovernanceCommand.EmpowerAssistant)
            state.assistantIsEmpowered = true;
          else if (command == GovernanceCommand.ProposeOwnershipTransfer) {
            address newOwner;
            (newOwner, offset) = commands.asAddressUnchecked(offset);

            state.pendingOwner = newOwner;
          }
          else { //must be GovernanceCommand.RelinquishOwnership
            _updateRole(Role.Owner, address(0));

            //ownership relinquishment must be the last command in the batch
            commands.checkLength(offset);
          }
        }
      }
    }
    commands.checkLength(offset);
  }

  // ---- internals ----

  function _getOwner() internal view returns (address) {
    return governanceState().owner;
  }

  function _getPendingOwner() internal view returns (address) {
    return governanceState().pendingOwner;
  }

  function _getAssistant() internal view returns (address) {
    return governanceState().assistant;
  }

  function _getFeeUpdater() internal view returns (address) {
    return governanceState().feeUpdater;
  }

  function _getFeeRecipient() internal view returns (address) {
    return governanceState().feeRecipient;
  }

  function _getAssistantIsEmpowered() internal view returns (bool) {
    return governanceState().assistantIsEmpowered;
  }

  // ---- private ----

  function _updateRole(Role role, address newAddress) private {
    GovernanceState storage state = governanceState();
    address oldAddress;
    if (role == Role.Owner) {
      oldAddress = state.owner;
      state.owner = newAddress;
      state.pendingOwner = address(0);
    }
    else if (role == Role.Assistant) {
      oldAddress = state.assistant;
      state.assistant = newAddress;
    }
    else if (role == Role.FeeUpdater) {
      oldAddress = state.feeUpdater;
      state.feeUpdater = newAddress;
    }
    else { //must be Role.FeeRecipient
    if (newAddress == address(0))
        revert InvalidFeeRecipient();

      oldAddress = state.feeRecipient;
      state.feeRecipient = newAddress;
    }
    emit RoleUpdated(role, oldAddress, newAddress, block.timestamp);
  }
}
