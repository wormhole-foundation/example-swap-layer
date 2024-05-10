// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.24;

import "wormhole-sdk/libraries/BytesParsing.sol";

import { IdempotentUpgrade } from "wormhole-sdk/proxy/ProxyBase.sol";
import { SLTBase } from "./SLTBase.sol";
import "./utils/UpgradeTester.sol";

import "swap-layer/assets/SwapLayerGovernance.sol";
import "swap-layer/assets/SwapLayerQuery.sol";

contract GovernanceTest is SLTBase {
  using BytesParsing for bytes;

  function testOwnerContractUpgrade() public {
    UpgradeTester upgradeTester = new UpgradeTester();
    (address implementation, ) =
      swapLayer.batchQueries(abi.encodePacked(QueryType.Implementation)).asAddressUnchecked(0);

    vm.expectRevert(NotAuthorized.selector);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.UpgradeContract, address(upgradeTester))
    );

    vm.startPrank(assistant);
    vm.expectRevert(NotAuthorized.selector);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.UpgradeContract, address(upgradeTester))
    );

    vm.startPrank(owner);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.UpgradeContract, address(upgradeTester))
    );

    vm.expectRevert(IdempotentUpgrade.selector);
    UpgradeTester(address(swapLayer)).upgradeTo(address(upgradeTester), new bytes(0));

    UpgradeTester(address(swapLayer)).upgradeTo(implementation, new bytes(0));

    (address restoredImplementation, ) =
      swapLayer.batchQueries(abi.encodePacked(QueryType.Implementation)).asAddressUnchecked(0);
    assertEq(restoredImplementation, implementation);
  }

  function testOwnershipTransfer() public {
    address newOwner = makeAddr("newOwner");

    vm.expectRevert(NotAuthorized.selector);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.ProposeOwnershipTransfer, newOwner)
    );

    vm.startPrank(owner);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.ProposeOwnershipTransfer, newOwner)
    );

    bytes memory getRes = swapLayer.batchQueries(abi.encodePacked(
      QueryType.Owner, QueryType.PendingOwner
    ));
    (address owner_,        ) = getRes.asAddressUnchecked(0);
    (address pendingOwner_, ) = getRes.asAddressUnchecked(20);

    assertEq(owner_,        owner);
    assertEq(pendingOwner_, newOwner);

    vm.startPrank(newOwner);
    swapLayer.batchGovernanceCommands(new bytes(0));

    getRes = swapLayer.batchQueries(abi.encodePacked(
      QueryType.Owner, QueryType.PendingOwner
    ));
    (owner_,        ) = getRes.asAddressUnchecked(0);
    (pendingOwner_, ) = getRes.asAddressUnchecked(20);

    assertEq(owner_, newOwner);
    assertEq(pendingOwner_, address(0));
  }

  function testUpdateAssistant() public {
    address newAssistant = makeAddr("newAssistant");

    vm.prank(assistant);
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
      abi.encodePacked(GovernanceCommand.UpdateFeeRecipient, newFeeRecipient)
    );

    vm.startPrank(assistant);
    vm.expectRevert(NotAuthorized.selector);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.UpdateFeeRecipient, newFeeRecipient)
    );

    vm.startPrank(owner);
    swapLayer.batchGovernanceCommands(
      abi.encodePacked(GovernanceCommand.UpdateFeeRecipient, newFeeRecipient)
    );

    (address feeRecipient_, ) =
      swapLayer.batchQueries(abi.encodePacked(QueryType.FeeRecipient)).asAddressUnchecked(0);

    assertEq(feeRecipient_, newFeeRecipient);
  }

  // function testRegisterPeer() public {
  //   bytes32 peer = bytes32(uint256(1));
  //   uint16 chain = type(uint16).max;

  //   vm.prank(owner);
  //   swapLayer.batchGovernanceCommands(abi.encodePacked(
  //     GovernanceCommand.RegisterPeer, chain, peer
  //   ));

  //   (bytes32 peer_, ) = swapLayer.batchQueries(abi.encodePacked(
  //     QueryType.Peer, chain
  //   )).asBytes32Unchecked(0);

  //   assertEq(peer_, peer);
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
