// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

//from here:
//https://github.com/traderjoe-xyz/joe-v2/blob/main/src/interfaces/ILBFactory.sol

interface ITJLBFactory {
  function owner() external view returns (address);
  function isQuoteAsset(address token) external view returns (bool);
  function addQuoteAsset(address quoteAsset) external;
}

//from here:
//https://github.com/traderjoe-xyz/joe-v2/blob/main/src/interfaces/ILBRouter.sol

interface ITJLBRouter {
  /**
   * @dev The liquidity parameters, such as:
   * - tokenX: The address of token X
   * - tokenY: The address of token Y
   * - binStep: The bin step of the pair
   * - amountX: The amount to send of token X
   * - amountY: The amount to send of token Y
   * - amountXMin: The min amount of token X added to liquidity
   * - amountYMin: The min amount of token Y added to liquidity
   * - activeIdDesired: The active id that user wants to add liquidity from
   * - idSlippage: The number of id that are allowed to slip
   * - deltaIds: The list of delta ids to add liquidity (`deltaId = activeId - desiredId`)
   * - distributionX: The distribution of tokenX with sum(distributionX) = 1e18 (100%) or 0 (0%)
   * - distributionY: The distribution of tokenY with sum(distributionY) = 1e18 (100%) or 0 (0%)
   * - to: The address of the recipient
   * - refundTo: The address of the recipient of the refunded tokens if too much tokens are sent
   * - deadline: The deadline of the transaction
   */
  struct LiquidityParameters {
    address tokenX;
    address tokenY;
    uint256 binStep;
    uint256 amountX;
    uint256 amountY;
    uint256 amountXMin;
    uint256 amountYMin;
    uint256 activeIdDesired;
    uint256 idSlippage;
    int256[] deltaIds;
    uint256[] distributionX;
    uint256[] distributionY;
    address to;
    address refundTo;
    uint256 deadline;
  }

  function getFactory() external view returns (ITJLBFactory);

  function createLBPair(address tokenX, address tokenY, uint24 activeId, uint16 binStep)
    external returns (address pair);

  function addLiquidity(LiquidityParameters calldata liquidityParameters) external returns (
    uint256 amountXAdded,
    uint256 amountYAdded,
    uint256 amountXLeft,
    uint256 amountYLeft,
    uint256[] memory depositIds,
    uint256[] memory liquidityMinted
  );
}