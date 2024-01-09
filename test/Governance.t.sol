// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.23;

import { BytesParsing } from "wormhole/WormholeBytesParsing.sol";

import { SwapLayerTestBase } from "./TestBase.sol";
import "./utils/UpgradeTester.sol";
import { IdempotentUpgrade } from "proxy/ProxyBase.sol";

import "swap-layer/assets/SwapLayerGovernance.sol";
import "swap-layer/assets/SwapLayerBatchGet.sol";

contract SwapLayerGovernanceTest is SwapLayerTestBase {
  using BytesParsing for bytes;

  function setUp() public {
    deployBase();
  }

  function testUpgradeContract() public {
    UpgradeTester upgradeTester = new UpgradeTester();
    (address implementation, ) = swapLayer.batchGet(abi.encodePacked(
      QueryType.Implementation
    )).asAddressUnchecked(0);

    vm.expectRevert(NotAuthorized.selector);
    swapLayer.executeGovernanceActions(
      abi.encodePacked(GovernanceAction.UpgradeContract, address(upgradeTester))
    );

    vm.prank(owner);
    swapLayer.executeGovernanceActions(
      abi.encodePacked(GovernanceAction.UpgradeContract, address(upgradeTester))
    );

    vm.expectRevert(IdempotentUpgrade.selector);
    UpgradeTester(address(swapLayer)).upgradeTo(address(upgradeTester), new bytes(0));

    UpgradeTester(address(swapLayer)).upgradeTo(implementation, new bytes(0));
  }

  function testOwnershipTransfer() public {
    address newOwner = makeAddr("newOwner");

    vm.expectRevert(NotAuthorized.selector);
    swapLayer.executeGovernanceActions(
      abi.encodePacked(GovernanceAction.ProposeOwnershipTransfer, address(0))
    );

    vm.prank(owner);
    swapLayer.executeGovernanceActions(
      abi.encodePacked(GovernanceAction.ProposeOwnershipTransfer, newOwner)
    );

    bytes memory getRes = swapLayer.batchGet(abi.encodePacked(
      QueryType.Owner, QueryType.PendingOwner
    ));
    (address owner_, ) = getRes.asAddressUnchecked(0);
    (address pendingOwner_, ) = getRes.asAddressUnchecked(20);

    assertEq(owner_, owner);
    assertEq(pendingOwner_, newOwner);

    vm.prank(newOwner);
    swapLayer.executeGovernanceActions(new bytes(0));

    getRes = swapLayer.batchGet(abi.encodePacked(
      QueryType.Owner, QueryType.PendingOwner
    ));

    (owner_, ) = getRes.asAddressUnchecked(0);
    (pendingOwner_, ) = getRes.asAddressUnchecked(20);

    assertEq(owner_, newOwner);
    assertEq(pendingOwner_, address(0));
  }

  function testUpdateAssistant() public {
    address newAssistant = makeAddr("newAssistant");

    vm.prank(owner);
    swapLayer.executeGovernanceActions(
      abi.encodePacked(GovernanceAction.UpdateAssistant, newAssistant)
    );

    (address newAssistant_, ) = swapLayer.batchGet(abi.encodePacked(
      QueryType.Assistant
    )).asAddressUnchecked(0);

    assertEq(newAssistant_, newAssistant);
  }

  function testUpdateFeeRecipient() public {
    address newFeeRecipient = makeAddr("newFeeRecipient");

    vm.prank(owner);
    swapLayer.executeGovernanceActions(
      abi.encodePacked(GovernanceAction.UpdateFeeRecipient, newFeeRecipient)
    );

    (address newFeeRecipient_, ) = swapLayer.batchGet(abi.encodePacked(
      QueryType.FeeRecipient
    )).asAddressUnchecked(0);

    assertEq(newFeeRecipient_, newFeeRecipient);
  }

  function testRegisterEndpoint() public {
    bytes32 endpoint = bytes32(uint256(1));
    uint16 chain = type(uint16).max;

    vm.prank(owner);
    swapLayer.executeGovernanceActions(abi.encodePacked(
      GovernanceAction.RegisterEndpoint, chain, endpoint
    ));

    (bytes32 endpoint_, ) = swapLayer.batchGet(abi.encodePacked(
      QueryType.Endpoint, chain
    )).asBytes32Unchecked(0);

    assertEq(endpoint_, endpoint);
  }

  function testSweepTokens() public {
    uint usdcAmount = 1e6;
    uint ethAmount = 1 ether;
    deal(address(usdc), address(swapLayer), usdcAmount);
    vm.deal(address(swapLayer), ethAmount);
    assertEq(usdc.balanceOf(owner), 0);
    uint ownerEthBalance = address(owner).balance;
    assertEq(usdc.balanceOf(address(swapLayer)), usdcAmount);
    assertEq(address(swapLayer).balance, ethAmount);
    vm.prank(owner);
    swapLayer.executeGovernanceActions(abi.encodePacked(
      GovernanceAction.SweepTokens, address(usdc),
      GovernanceAction.SweepTokens, address(0)
    ));
    assertEq(usdc.balanceOf(address(swapLayer)), 0);
    assertEq(address(swapLayer).balance, 0);
    assertEq(usdc.balanceOf(owner), usdcAmount);
    assertEq(address(owner).balance, ownerEthBalance + ethAmount);
  }
}