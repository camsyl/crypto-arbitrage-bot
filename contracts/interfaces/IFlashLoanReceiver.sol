// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

/**
 * @title IFlashLoanReceiver
 * @dev Interface for the Aave flash loan receiver contract
 */
interface IFlashLoanReceiver {
    /**
     * @dev Executes an operation after receiving the flash-borrowed assets
     * @param assets The addresses of the flash-borrowed assets
     * @param amounts The amounts of the flash-borrowed assets
     * @param premiums The fee to be paid for each borrowed asset
     * @param initiator The address of the flashloan initiator
     * @param params Encoded parameters for the flashloan
     * @return A boolean value indicating whether the operation succeeded
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}