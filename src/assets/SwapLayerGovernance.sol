// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ProxyBase } from "proxy/ProxyBase.sol";
import { BytesParsing } from "wormhole/libraries/BytesParsing.sol";

import { FeeParams, FeeParamsLib, SwapLayerRelayingFees } from "./SwapLayerRelayingFees.sol";

//rationale for different roles (owner, admin, assistant):
// * owner should be an ultra cold wallet that is only activated in exceptional circumstances.
// * admin should also be either a cold wallet or admin contract. In either case, the expectation
//     is that multiple, slightly less trustworthy parties than the owner will have access to
//     it. Admins perform rare but not exceptional operations like registering new endpoints, etc.
// * assistant is a hot wallet that is used to update fee parameters and the like.

//rationale for lock periods:
// * ownership transfer: _majorDelay
//     While leaking the owner secret is a devastating and likely irrecoverable plunder, having an
//       ownership transfer lock period nevertheless allows the legitimate owner to duke things out
//       in the form of a gas war over nonce-cancels with the attacker. By setting up the rest of
//       the contract in a way that an attacker has no short-term incentive to capture the contract
//       (e.g. by also having a lock period on the fee recipient transfer as well), any attack that
//       fails to capture the contract is guaranteed to be a loss for the attacker, and so the only
//       thing they may be able to accomplish is denial of service.
//     This in turn opens the door for the legitimate owner (whose vested interest in keeping
//       control of the contract should be bigger than the attacker's) to eventually regain control
//       with an ownership transfer to a new, secure secret.
// * contract upgrade: _majorDelay
//     A lock period for contract upgrades ensures that users of the protocol can't get rugged out
//       of nowhere, even when the owner becomes compromised.
//     The contract upgrade lock period must always be at least as long as the ownership transfer
//       lock period, since contract upgrades can also be used to change ownership.
// * fee recipient transfer: _minorDelay
//     As mentioned in the ownership transfer rationale, having a lock period on the fee recipient
//       transfer prevents an attacker from capturing any benefits from capturing the contract in
//       the short term.
//     A lack of short term incentive (such as siphoning off fees) should put a damper on any
//       attackers enthusiasm to keep fighting over control of the contract.
// * admin transfer: _minorDelay

struct EndpointProposal {
  bytes32 endpoint;
  uint32  unlockTime;
}

struct Proposal {
  address addr;
  uint32  unlockTime;
}

struct Role {
  address  current;
  Proposal proposed;
}

struct GovernanceState {
  Role     admin; //puts admin address in eip1967 admin slot
  Role     owner;
  address  assistant;
  Role     feeRecipient;
  Proposal proposedImplementation;
  bool     adminCanUpgradeContract;
  mapping (uint16 => EndpointProposal) endpointProposals;
}

// we use the designated eip1967 admin storage slot: keccak256("eip1967.proxy.admin") - 1
bytes32 constant GOVERNANCE_STORAGE_SLOT =
  0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

function governanceState() pure returns (GovernanceState storage state) {
  assembly ("memory-safe") { state.slot := GOVERNANCE_STORAGE_SLOT }
}

error InconsistentDelayValues(uint32 majorDelay, uint32 minorDelay);
error NotAuthorized();
error InvalidFeeRecipient();

enum UpdateType {
  Admin,
  Owner,
  Assistant,
  FeeRecipient,
  Implementation
}

error ProposalNotYetUnlocked(UpdateType uType, uint currentTime, uint unlockTime);
error ProposalMissing(UpdateType uType);
error ProposalMismatch(UpdateType uType, address passed, address proposed);

event ProposalSubmitted(UpdateType indexed uType, address proposed, uint unlockTime);
event ProposalCancelled(UpdateType indexed uType);

event UpdateProcessed(
  UpdateType indexed uType,
  address indexed old,
  address indexed new_,
  uint timestamp
);

error EndpointProposalShouldBeUpdate(uint16 chainId);
error EndpointProposalNotYetUnlocked(uint16 chainId, uint currentTime, uint unlockTime);
error EndpointProposalMissing(uint16 chainId);
error EndpointProposalMismatch(uint16 chainId, bytes32 passed, bytes32 proposed);

event EndpointProposalSubmitted(uint16 indexed chainId, bytes32 endpoint, uint unlockTime);
event EndpointProposalCancelled(uint16 indexed chainId);
event EndpointUpdateProcessed(uint16 indexed chainId, bytes32 old, bytes32 new_, uint timestamp);

enum GovernanceCommand {
  UpdateEndpoint,
  ProposeEndpointUpdate,
  SweepTokens,
  UpdateAssistant,
  UpdateFeeRecipient,
  ProposeFeeRecipientUpdate,
  UpgradeContract,
  ProposeContractUpgrade,
  ProposeAdminTransfer,
  CancelEndpointUpdate,
  CancelFeeRecipientUpdate,
  CancelContractUpgrade,
  CancelAdminTransfer,
  DisableAdminCanUpgradeContract,
  RelinquishAdmin
}

enum OwnerIntervention {
  UpdateAdmin,
  EnableAdminCanUpgradeContract,
  ProposeOwnershipTransfer,
  CancelOwnershipTransfer,
  RelinquishOwnership
}

abstract contract SwapLayerGovernance is SwapLayerRelayingFees, ProxyBase {
  using BytesParsing for bytes;
  using SafeERC20 for IERC20;

  uint32 internal immutable _majorDelay;
  uint32 internal immutable _minorDelay;

  // ---- construction ----

  constructor(uint32 majorDelay, uint32 minorDelay) {
    if (majorDelay < minorDelay)
      revert InconsistentDelayValues(majorDelay, minorDelay);

    _majorDelay = majorDelay;
    _minorDelay = minorDelay;
  }

  function _governanceConstruction(
    address owner,
    address admin,
    address assistant,
    address feeRecipient,
    bool    adminCanUpgradeContract
  ) internal {
    if (feeRecipient == address(0))
      revert InvalidFeeRecipient();

    GovernanceState storage state = governanceState();
    state.owner.current           = owner;
    state.admin.current           = admin;
    state.assistant               = assistant;
    state.feeRecipient.current    = feeRecipient;
    state.adminCanUpgradeContract = adminCanUpgradeContract;
  }

  // ---- externals ----

  //selector: 9efc05ce
  function batchFeeUpdates(bytes memory updates) external {
    GovernanceState storage state = governanceState();
    if (msg.sender != state.assistant &&
        msg.sender != state.admin.current &&
        msg.sender != state.owner.current)
      revert NotAuthorized();

    _batchFeeUpdates(updates);
  }

  //selector: a9bb3dca
  function batchGovernanceCommands(bytes calldata commands) external {
    GovernanceState storage state = governanceState();
    if (msg.sender != state.admin.current && msg.sender != state.owner.current) {
      if (msg.sender == state.admin.proposed.addr)
        _updateRole(UpdateType.Admin, state.admin, msg.sender);
      else
        revert NotAuthorized();
    }

    uint offset = 0;
    while (offset < commands.length) {
      uint8 command_;
      (command_, offset) = commands.asUint8Unchecked(offset);
      GovernanceCommand command = GovernanceCommand(command_);
      if (command == GovernanceCommand.UpdateEndpoint ||
          command == GovernanceCommand.ProposeEndpointUpdate) {
        uint16 endpointChain;
        bytes32 newEndpoint;
        (endpointChain, offset) = commands.asUint16Unchecked(offset);
        (newEndpoint,   offset) = commands.asBytes32Unchecked(offset);

        bytes32 curEndpoint = _getEndpoint(endpointChain);
        if (newEndpoint != curEndpoint) {
          if (command == GovernanceCommand.UpdateEndpoint) {
            if (curEndpoint != bytes32(0)) {
              EndpointProposal storage proposal = state.endpointProposals[endpointChain];
              uint32 unlockTime = proposal.unlockTime;
              if (unlockTime == 0)
                revert EndpointProposalMissing(endpointChain);

              if (block.timestamp < unlockTime)
                revert EndpointProposalNotYetUnlocked(endpointChain, block.timestamp, unlockTime);

              if (newEndpoint != proposal.endpoint)
                revert EndpointProposalMismatch(endpointChain, newEndpoint, proposal.endpoint);

              delete state.endpointProposals[endpointChain];
            }

            uint256 feeParams_;
            (feeParams_, offset) = commands.asUint256Unchecked(offset);
            FeeParams feeParams = newEndpoint == bytes32(0)
              ? FeeParams.wrap(0)
              : FeeParamsLib.checkedWrap(feeParams_);
            _updateEndpoint(endpointChain, curEndpoint, newEndpoint, feeParams);
          }
          else { //must be GovernanceCommand.ProposeEndpointUpdate
            if (newEndpoint == bytes32(0))
              revert EndpointProposalShouldBeUpdate(endpointChain);

            EndpointProposal storage proposal = state.endpointProposals[endpointChain];
            proposal.endpoint = newEndpoint;
            proposal.unlockTime = uint32(block.timestamp + _majorDelay);
            emit EndpointProposalSubmitted(endpointChain, newEndpoint, proposal.unlockTime);
          }
        }
      }
      else if (command == GovernanceCommand.SweepTokens) {
        address token;
        (token, offset) = commands.asAddressUnchecked(offset);

        if (token == address(0))
          _transferEth(msg.sender, address(this).balance);
        else
          IERC20(token).safeTransfer(msg.sender, IERC20(token).balanceOf(address(this)));
      }
      else if (command == GovernanceCommand.UpdateAssistant) {
        address newAssistant;
        (newAssistant, offset) = commands.asAddressUnchecked(offset);

        emit UpdateProcessed(UpdateType.Assistant, state.assistant, newAssistant, block.timestamp);
        state.assistant = newAssistant;
      }
      else if (command == GovernanceCommand.UpdateFeeRecipient ||
               command == GovernanceCommand.ProposeFeeRecipientUpdate) {
        address newFeeRecipient;
        (newFeeRecipient, offset) = commands.asAddressUnchecked(offset);

        if (command == GovernanceCommand.UpdateFeeRecipient)
          _updateRole(UpdateType.FeeRecipient, state.feeRecipient, newFeeRecipient);
        else {
          if (newFeeRecipient == address(0))
            revert InvalidFeeRecipient();

          _submitProposal(
            UpdateType.FeeRecipient, state.feeRecipient.proposed, newFeeRecipient, _minorDelay
          );
        }
      }
      else if (command == GovernanceCommand.UpgradeContract ||
               command == GovernanceCommand.ProposeContractUpgrade) {
        //check for != owner instead of == admin in case owner and admin are one and the same
        if (msg.sender != state.owner.current && !state.adminCanUpgradeContract)
          revert NotAuthorized();

        address newImplementation;
        (newImplementation, offset) = commands.asAddressUnchecked(offset);

        if (command == GovernanceCommand.UpgradeContract) {
          //contract upgrades must be the last command in the batch
          commands.checkLength(offset);

          _processProposal(
            UpdateType.Implementation,
            state.proposedImplementation,
            _getImplementation(),
            newImplementation
          );

          _upgradeTo(newImplementation, new bytes(0));
        }
        else
          _submitProposal(
            UpdateType.Implementation,
            state.proposedImplementation,
            newImplementation,
            _majorDelay
          );
      }
      else if (command == GovernanceCommand.ProposeAdminTransfer) {
        address newAdmin;
        (newAdmin, offset) = commands.asAddressUnchecked(offset);

        _submitProposal(
          UpdateType.Admin,
          state.admin.proposed,
          newAdmin,
          _minorDelay
        );
      }
      else if (command == GovernanceCommand.CancelEndpointUpdate) {
        uint16 endpointChain;
        (endpointChain, offset) = commands.asUint16Unchecked(offset);

        delete state.endpointProposals[endpointChain];
        emit EndpointProposalCancelled(endpointChain);
      }
      else if (command == GovernanceCommand.CancelFeeRecipientUpdate)
        _cancelProposal(UpdateType.FeeRecipient, state.feeRecipient.proposed);
      else if (command == GovernanceCommand.CancelContractUpgrade)
        _cancelProposal(UpdateType.Implementation, state.proposedImplementation);
      else if (command == GovernanceCommand.CancelAdminTransfer)
        _cancelProposal(UpdateType.Admin, state.admin.proposed);
      else if (command == GovernanceCommand.DisableAdminCanUpgradeContract)
        state.adminCanUpgradeContract = false;
      else { //must be GovernanceCommand.RelinquishAdmin
        _updateRole(UpdateType.Admin, state.admin, address(0));
        //admin relinquishment must be the last command in the batch
        commands.checkLength(offset);
      }
    }
    commands.checkLength(offset);
  }

  //selector: e60df1a0
  function batchOwnerInterventions(bytes calldata interventions) external {
    GovernanceState storage state = governanceState();
    if (msg.sender != state.owner.current) {
      if (msg.sender == state.owner.proposed.addr)
        _updateRole(UpdateType.Owner, state.owner, msg.sender);
      else
        revert NotAuthorized();
    }

    uint offset = 0;
    while (offset < interventions.length) {
      uint8 intervention_;
      (intervention_, offset) = interventions.asUint8Unchecked(offset);
      OwnerIntervention intervention = OwnerIntervention(intervention_);

      if (intervention == OwnerIntervention.UpdateAdmin) {
        address newAdmin;
        (newAdmin, offset) = interventions.asAddressUnchecked(offset);

        emit UpdateProcessed(UpdateType.Admin, state.admin.current, newAdmin, block.timestamp);
        state.admin.current = newAdmin;
        _resetProposal(state.admin.proposed);
      }
      else if (intervention == OwnerIntervention.EnableAdminCanUpgradeContract)
        state.adminCanUpgradeContract = true;
      else if (intervention == OwnerIntervention.ProposeOwnershipTransfer) {
        address newOwner;
        (newOwner, offset) = interventions.asAddressUnchecked(offset);

        _submitProposal(
          UpdateType.Owner,
          state.owner.proposed,
          newOwner,
          _majorDelay
        );
      }
      else if (intervention == OwnerIntervention.CancelOwnershipTransfer)
        _cancelProposal(UpdateType.Owner, state.owner.proposed);
      else { //must be OwnerIntervention.RelinquishOwnership
        _updateRole(UpdateType.Owner, state.owner, address(0));
        state.adminCanUpgradeContract = false;

        //ownership relinquishment must be the last intervention in the batch
        interventions.checkLength(offset);
      }
    }
    interventions.checkLength(offset);
  }

  // ---- internals ----

  function _updateEndpoint(
    uint16 endpointChain,
    bytes32 curEndpoint,
    bytes32 newEndpoint,
    FeeParams feeParams
  ) internal {
    _setEndpoint(endpointChain, newEndpoint);
    _setFeeParams(endpointChain, feeParams);
    emit EndpointUpdateProcessed(endpointChain, curEndpoint, newEndpoint, block.timestamp);
  }

  function _getAdmin() internal view returns (address) {
    return governanceState().admin.current;
  }

  function _getProposedAdmin() internal view returns (address) {
    return governanceState().admin.proposed.addr;
  }

  function _getProposedAdminUnlockTime() internal view returns (uint32) {
    return governanceState().admin.proposed.unlockTime;
  }

  function _getOwner() internal view returns (address) {
    return governanceState().owner.current;
  }

  function _getProposedOwner() internal view returns (address) {
    return governanceState().owner.proposed.addr;
  }

  function _getProposedOwnerUnlockTime() internal view returns (uint32) {
    return governanceState().owner.proposed.unlockTime;
  }

  function _getFeeRecipient() internal view returns (address) {
    return governanceState().feeRecipient.current;
  }

  function _getProposedFeeRecipient() internal view returns (address) {
    return governanceState().feeRecipient.proposed.addr;
  }

  function _getProposedFeeRecipientUnlockTime() internal view returns (uint32) {
    return governanceState().feeRecipient.proposed.unlockTime;
  }

  function _getProposedImplementation() internal view returns (address) {
    return governanceState().proposedImplementation.addr;
  }

  function _getProposedImplementationUnlockTime() internal view returns (uint32) {
    return governanceState().proposedImplementation.unlockTime;
  }

  function _getAssistant() internal view returns (address) {
    return governanceState().assistant;
  }

  function _getAdminCanUpgradeContract() internal view returns (bool) {
    return governanceState().adminCanUpgradeContract;
  }

  function _getProposedEndpoint(uint16 chainId) internal view returns (bytes32) {
    return governanceState().endpointProposals[chainId].endpoint;
  }

  function _getProposedEndpointUnlockTime(uint16 chainId) internal view returns (uint32) {
    return governanceState().endpointProposals[chainId].unlockTime;
  }

  // ---- private ----

  function _updateRole(UpdateType uType, Role storage role, address passed) private {
    _processProposal(uType, role.proposed, role.current, passed);
    role.current = passed;
  }

  function _processProposal(
    UpdateType uType,
    Proposal storage proposal,
    address old,
    address passed
  ) private {
    _checkProposal(uType, proposal, passed);
    emit UpdateProcessed(uType, old, passed, block.timestamp);
    _resetProposal(proposal);
  }

  function _checkProposal(
    UpdateType uType,
    Proposal storage proposal,
    address passed
  ) private view {
    _checkLockPeriod(uType, proposal.unlockTime);
    if (passed != proposal.addr)
      revert ProposalMismatch(uType, passed, proposal.addr);
  }

  function _checkLockPeriod(UpdateType uType, uint unlockTime) private view {
    if (unlockTime == 0)
      revert ProposalMissing(uType);

    if (block.timestamp < unlockTime)
      revert ProposalNotYetUnlocked(uType, block.timestamp, unlockTime);
  }

  function _submitProposal(
    UpdateType uType,
    Proposal storage proposal,
    address passed,
    uint delay
  ) private {
    emit ProposalSubmitted(uType, passed, uint32(block.timestamp + delay));
    proposal.addr = passed;
    proposal.unlockTime = uint32(block.timestamp + delay);
  }

  function _cancelProposal(UpdateType uType, Proposal storage proposal) private {
    emit ProposalCancelled(uType);
    _resetProposal(proposal);
  }

  function _resetProposal(Proposal storage proposal) private {
    proposal.addr = address(0);
    proposal.unlockTime = 0;
  }
}
