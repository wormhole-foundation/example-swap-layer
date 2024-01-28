// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import { BytesParsing } from "wormhole-sdk/libraries/BytesParsing.sol";

import { SwapLayerTestBase } from "./TestBase.sol";
import "./utils/UpgradeTester.sol";
import { IdempotentUpgrade } from "proxy/ProxyBase.sol";

import "swap-layer/assets/SwapLayerGovernance.sol";
import "swap-layer/assets/SwapLayerQuery.sol";

contract SwapLayerGovernanceTest is SwapLayerTestBase {
  using BytesParsing for bytes;

  function setUp() public {
    deployBase();
  }

  function testOwnerContractUpgrade() public {
    UpgradeTester upgradeTester = new UpgradeTester();
    (address implementation, ) = swapLayer.batchQueries(abi.encodePacked(
      QueryType.Implementation, SubQueryType.Current
    )).asAddressUnchecked(0);

    vm.expectRevert(NotAuthorized.selector);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.UpgradeContract, address(upgradeTester))
    );

    vm.startPrank(owner);
    vm.expectRevert(abi.encodeWithSelector(ProposalMissing.selector, UpdateType.Implementation));
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.UpgradeContract, address(upgradeTester))
    );

    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.ProposeContractUpgrade, address(upgradeTester))
    );

    if (MAJOR_DELAY > 0) {
      //should revert with ProposalLockPeriodNotOver but we can't enforce the exact timestamps
      vm.expectRevert();
      swapLayer.batchGovernanceCommands(
        abi.encodePacked(GovernanceCommand.UpgradeContract, address(upgradeTester))
      );

      skip(MAJOR_DELAY);
    }

    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.UpgradeContract, address(upgradeTester))
    );

    vm.expectRevert(IdempotentUpgrade.selector);
    UpgradeTester(address(swapLayer)).upgradeTo(address(upgradeTester), new bytes(0));

    UpgradeTester(address(swapLayer)).upgradeTo(implementation, new bytes(0));

    (address restoredImplementation, ) = swapLayer.batchQueries(abi.encodePacked(
      QueryType.Implementation, SubQueryType.Current
    )).asAddressUnchecked(0);
    assertEq(restoredImplementation, implementation);
  }

  function testAdminContractUpgrade() public {
    UpgradeTester upgradeTester = new UpgradeTester();
    (bool adminCanUpgrade, ) = swapLayer.batchQueries(abi.encodePacked(
      QueryType.AdminCanUpgradeContract
    )).asBoolUnchecked(0);

    assertEq(adminCanUpgrade, false);

    vm.startPrank(admin);
    vm.expectRevert(NotAuthorized.selector);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.ProposeContractUpgrade, address(upgradeTester))
    );

    vm.startPrank(owner);
    swapLayer.batchOwnerInterventions(
      abi.encodePacked(OwnerIntervention.EnableAdminCanUpgradeContract)
    );

    vm.startPrank(admin);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.ProposeContractUpgrade, address(upgradeTester))
    );

    if (MAJOR_DELAY > 0) {
      //should revert with ProposalLockPeriodNotOver but we can't enforce the exact timestamps
      vm.expectRevert();
      swapLayer.batchGovernanceCommands(
        abi.encodePacked(GovernanceCommand.UpgradeContract, address(upgradeTester))
      );

      skip(MAJOR_DELAY);
    }

    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.UpgradeContract, address(upgradeTester))
    );
  }

  function testOwnershipTransfer() public {
    address newOwner = makeAddr("newOwner");

    vm.expectRevert(NotAuthorized.selector);
    swapLayer.batchOwnerInterventions(
      abi.encodePacked(OwnerIntervention.ProposeOwnershipTransfer, newOwner)
    );

    vm.prank(owner);
    swapLayer.batchOwnerInterventions(
      abi.encodePacked(OwnerIntervention.ProposeOwnershipTransfer, newOwner)
    );

    bytes memory getRes = swapLayer.batchQueries(abi.encodePacked(
      QueryType.Owner, SubQueryType.Current,
      QueryType.Owner, SubQueryType.Proposed
    ));
    (address owner_, ) = getRes.asAddressUnchecked(0);
    (address pendingOwner_, ) = getRes.asAddressUnchecked(20);

    assertEq(owner_, owner);
    assertEq(pendingOwner_, newOwner);

    vm.startPrank(newOwner);
    if (MAJOR_DELAY > 0) {
      //should revert with ProposalLockPeriodNotOver but we can't enforce the exact timestamps
      vm.expectRevert();
      swapLayer.batchOwnerInterventions(new bytes(0));

      skip(MAJOR_DELAY);
    }

    swapLayer.batchOwnerInterventions(new bytes(0));

    getRes = swapLayer.batchQueries(abi.encodePacked(
      QueryType.Owner, SubQueryType.Current,
      QueryType.Owner, SubQueryType.Proposed
    ));

    (owner_, ) = getRes.asAddressUnchecked(0);
    (pendingOwner_, ) = getRes.asAddressUnchecked(20);

    assertEq(owner_, newOwner);
    assertEq(pendingOwner_, address(0));
  }

  function testUpdateAssistant() public {
    address newAssistant = makeAddr("newAssistant");

    vm.prank(owner);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.UpdateAssistant, newAssistant)
    );

    (address newAssistant_, ) = swapLayer.batchQueries(abi.encodePacked(
      QueryType.Assistant
    )).asAddressUnchecked(0);

    assertEq(newAssistant_, newAssistant);
  }

  function testUpdateFeeRecipient() public {
    address newFeeRecipient = makeAddr("newFeeRecipient");

    vm.expectRevert(NotAuthorized.selector);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.ProposeFeeRecipientUpdate, newFeeRecipient)
    );

    vm.startPrank(admin);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.ProposeFeeRecipientUpdate, newFeeRecipient)
    );

    bytes memory getRes = swapLayer.batchQueries(abi.encodePacked(
      QueryType.FeeRecipient, SubQueryType.Current,
      QueryType.FeeRecipient, SubQueryType.Proposed
    ));
    (address feeRecipient_, ) = getRes.asAddressUnchecked(0);
    (address pendingFeeRecipient_, ) = getRes.asAddressUnchecked(20);

    assertEq(feeRecipient_, feeRecipient);
    assertEq(pendingFeeRecipient_, newFeeRecipient);

    if (MINOR_DELAY > 0) {
      //should revert with ProposalLockPeriodNotOver but we can't enforce the exact timestamps
      vm.expectRevert();
      swapLayer.batchGovernanceCommands(
        abi.encodePacked(GovernanceCommand.UpdateFeeRecipient, newFeeRecipient)
      );

      skip(MINOR_DELAY);
    }

    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.UpdateFeeRecipient, newFeeRecipient)
    );

    getRes = swapLayer.batchQueries(abi.encodePacked(
      QueryType.FeeRecipient, SubQueryType.Current,
      QueryType.FeeRecipient, SubQueryType.Proposed
    ));
    (feeRecipient_, ) = getRes.asAddressUnchecked(0);
    (pendingFeeRecipient_, ) = getRes.asAddressUnchecked(20);

    assertEq(feeRecipient_, newFeeRecipient);
    assertEq(pendingFeeRecipient_, address(0));
  }

  // function testRegisterEndpoint() public {
  //   bytes32 endpoint = bytes32(uint256(1));
  //   uint16 chain = type(uint16).max;

  //   vm.prank(owner);
  //   swapLayer.batchGovernanceCommands(abi.encodePacked(
  //     GovernanceCommand.RegisterEndpoint, chain, endpoint
  //   ));

  //   (bytes32 endpoint_, ) = swapLayer.batchQueries(abi.encodePacked(
  //     QueryType.Endpoint, chain
  //   )).asBytes32Unchecked(0);

  //   assertEq(endpoint_, endpoint);
  // }

  function testSweepTokens() public {
    uint usdcAmount = 1e6;
    uint ethAmount = 1 ether;
    _dealOverride(address(usdc), address(swapLayer), usdcAmount);
    vm.deal(address(swapLayer), ethAmount);
    assertEq(usdc.balanceOf(owner), 0);
    uint ownerEthBalance = address(owner).balance;
    assertEq(usdc.balanceOf(address(swapLayer)), usdcAmount);
    assertEq(address(swapLayer).balance, ethAmount);
    vm.prank(owner);
    swapLayer.batchGovernanceCommands(abi.encodePacked(
      GovernanceCommand.SweepTokens, address(usdc),
      GovernanceCommand.SweepTokens, address(0)
    ));
    assertEq(usdc.balanceOf(address(swapLayer)), 0);
    assertEq(address(swapLayer).balance, 0);
    assertEq(usdc.balanceOf(owner), usdcAmount);
    assertEq(address(owner).balance, ownerEthBalance + ethAmount);
  }
}
