// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

/**
 * @title ILendingPool
 * @dev Interface for the Aave lending pool
 */
interface ILendingPool {
    /**
     * @dev Allows smart contracts to access the liquidity of the pool within one transaction,
     * as long as the amount taken plus a fee is returned.
     * @param receiverAddress The address of the contract receiving the funds, implementing IFlashLoanReceiver interface
     * @param assets The addresses of the assets being flash-borrowed
     * @param amounts The amounts of the assets being flash-borrowed
     * @param modes Types of the debt to open if the flash loan is not returned
     *   (0 = no debt, 1 = stable, 2 = variable)
     * @param onBehalfOf The address that will receive the debt in case of using on a deferred borrowing mode
     * @param params Encoded parameters to pass to the receiver contract
     * @param referralCode Referral code used for the flash loan
     */
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;

    /**
     * @dev Returns the state and configuration of the reserve
     * @param asset The address of the underlying asset of the reserve
     */
    function getReserveData(address asset) external view returns (
        uint256,
        uint128,
        uint128,
        uint128,
        uint128,
        uint128,
        uint40,
        address,
        address,
        address,
        uint8
    );

    /**
     * @dev Returns the user account data across all the reserves
     * @param user The address of the user
     * @return totalCollateralETH The total collateral in ETH of the user
     * @return totalDebtETH The total debt in ETH of the user
     * @return availableBorrowsETH The borrowing power left of the user
     * @return currentLiquidationThreshold The liquidation threshold of the user
     * @return ltv The loan to value of the user
     * @return healthFactor The current health factor of the user
     */
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralETH,
            uint256 totalDebtETH,
            uint256 availableBorrowsETH,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
}