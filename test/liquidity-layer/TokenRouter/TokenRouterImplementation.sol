// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {BytesParsing} from "wormhole/WormholeBytesParsing.sol";

import {getOwnerState, getOwnerAssistantState} from "../shared/Admin.sol";

import {TokenRouterAdmin} from "./assets/TokenRouterAdmin.sol";
import {PlaceMarketOrder} from "./assets/PlaceMarketOrder.sol";
import {RedeemFill} from "./assets/RedeemFill.sol";
import {State} from "./assets/State.sol";

contract TokenRouterImplementation is TokenRouterAdmin, PlaceMarketOrder, RedeemFill {
    constructor(
        address token_,
        address wormhole_,
        address cctpTokenMessenger_,
        uint16 matchingEngineChain_,
        bytes32 matchingEngineAddress_,
        uint32 matchingEngineDomain_
    )
        State(
            token_,
            wormhole_,
            cctpTokenMessenger_,
            matchingEngineChain_,
            matchingEngineAddress_,
            matchingEngineDomain_
        )
    {}

    function initialize(address owner, address ownerAssistant) external {
        require(owner != address(0), "Invalid owner");
        require(getOwnerState().owner == address(0), "Already initialized");

        getOwnerState().owner = owner;
        getOwnerAssistantState().ownerAssistant = ownerAssistant;
    }
}
