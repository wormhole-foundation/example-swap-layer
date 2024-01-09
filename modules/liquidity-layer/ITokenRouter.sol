// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./ITokenRouterTypes.sol";
import "./IPlaceMarketOrder.sol";
import "./IRedeemFill.sol";
import "./ITokenRouterState.sol";
import "./ITokenRouterAdmin.sol";
import "./IAdmin.sol";

interface ITokenRouter is
    IPlaceMarketOrder,
    IRedeemFill,
    ITokenRouterState,
    ITokenRouterAdmin,
    IAdmin
{}
