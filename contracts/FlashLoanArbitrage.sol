// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./interfaces/ILendingPool.sol";
import "./interfaces/IFlashLoanReceiver.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/ISwapRouter.sol";
import "./interfaces/ICurvePool.sol";
import "./interfaces/ISushiRouter.sol";

/**
 * @title FlashLoanArbitrage
 * @dev Contract to execute flash loan-based arbitrage between different DEXes
 */
contract FlashLoanArbitrage is IFlashLoanReceiver, Ownable, ReentrancyGuard {
    // Constants
    address private constant AAVE_LENDING_POOL = 0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9; // Aave V2 on Ethereum Mainnet
    address private constant UNISWAP_V3_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address private constant SUSHISWAP_ROUTER = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F;
    
    // Interfaces
    ILendingPool public lendingPool;
    ISwapRouter public uniswapRouter;
    ISushiRouter public sushiswapRouter;
    
    // Dex identifiers
    enum Dex {
        Uniswap,
        Sushiswap,
        Curve
    }
    
    // Events
    event ArbitrageExecuted(
        address indexed tokenA,
        address indexed tokenB,
        uint amountBorrowed,
        uint profit,
        uint timestamp
    );
    
    event ArbitrageFailed(
        address indexed tokenA,
        address indexed tokenB,
        string reason,
        uint timestamp
    );
    
    /**
     * @dev Constructor to initialize the contract
     */
    constructor() {
        lendingPool = ILendingPool(AAVE_LENDING_POOL);
        uniswapRouter = ISwapRouter(UNISWAP_V3_ROUTER);
        sushiswapRouter = ISushiRouter(SUSHISWAP_ROUTER);
    }
    
    /**
     * @dev Execute a flash loan arbitrage
     * @param tokenA The address of the token to borrow
     * @param tokenB The address of the token to swap with
     * @param amount The amount to borrow
     * @param buyDex The DEX to buy tokenB with tokenA
     * @param sellDex The DEX to sell tokenB for tokenA
     * @param curvePoolForBuy The Curve pool address for buy (if applicable)
     * @param curvePoolForSell The Curve pool address for sell (if applicable)
     */
    function executeArbitrage(
        address tokenA,
        address tokenB,
        uint256 amount,
        Dex buyDex,
        Dex sellDex,
        address curvePoolForBuy,
        address curvePoolForSell
    ) external onlyOwner nonReentrant {
        // Validate inputs
        require(tokenA != address(0) && tokenB != address(0), "Invalid token addresses");
        require(amount > 0, "Amount must be greater than 0");
        
        // Encode parameters for the flash loan callback
        bytes memory params = abi.encode(
            tokenA,
            tokenB,
            buyDex,
            sellDex,
            curvePoolForBuy,
            curvePoolForSell
        );
        
        // Create the array of tokens and amounts for the flash loan
        address[] memory assets = new address[](1);
        assets[0] = tokenA;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        
        // Execute the flash loan
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // 0 = no debt, 1 = stable, 2 = variable
        
        // Call Aave's flash loan function
        lendingPool.flashLoan(
            address(this),  // Receiver address
            assets,         // Assets to borrow
            amounts,        // Amounts to borrow
            modes,          // Modes
            address(this),  // On behalf of
            params,         // Parameters
            0               // Referral code
        );
    }
    
    /**
     * @dev This function is called after the contract receives the flash loaned amount
     * @notice This function must be implemented as part of the IFlashLoanReceiver interface
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Ensure the caller is the Aave lending pool
        require(msg.sender == AAVE_LENDING_POOL, "Caller must be Aave Lending Pool");
        require(initiator == address(this), "Initiator must be this contract");
        
        // Decode the parameters
        (
            address tokenA,
            address tokenB,
            Dex buyDex,
            Dex sellDex,
            address curvePoolForBuy,
            address curvePoolForSell
        ) = abi.decode(params, (address, address, Dex, Dex, address, address));
        
        // The amount borrowed
        uint256 borrowedAmount = amounts[0];
        
        // The fee that needs to be repaid
        uint256 fee = premiums[0];
        
        // Total amount to repay
        uint256 totalRepayment = borrowedAmount + fee;
        
        // Use a flag to track success
        bool success = false;
        string memory errorMsg = "";

        // Execute the arbitrage
        try this.executeArbitrageLogic(
            tokenA,
            tokenB,
            borrowedAmount,
            buyDex,
            sellDex,
            curvePoolForBuy,
            curvePoolForSell,
            totalRepayment
        ) returns (uint256 profit) {
            // Log the successful arbitrage
            emit ArbitrageExecuted(tokenA, tokenB, borrowedAmount, profit, block.timestamp);
            success = true;
        } catch Error(string memory reason) {
            // Log the reason for failure
            errorMsg = reason;
            emit ArbitrageFailed(tokenA, tokenB, reason, block.timestamp);
        } catch (bytes memory /*reason*/) {
            // Log a generic failure message
            errorMsg = "Unknown error occurred";
            emit ArbitrageFailed(tokenA, tokenB, "Unknown error occurred", block.timestamp);
        }
        
        // We always need to repay the flash loan, regardless of whether the arbitrage was successful
        IERC20(tokenA).approve(AAVE_LENDING_POOL, totalRepayment);
        
        return true;  // Must return true to indicate the flash loan can be paid back
    }

    /**
     * @dev Logic for executing the arbitrage, separated for proper error handling
     */
    function executeArbitrageLogic(
        address tokenA,
        address tokenB,
        uint256 borrowedAmount,
        Dex buyDex,
        Dex sellDex,
        address curvePoolForBuy,
        address curvePoolForSell,
        uint256 totalRepayment
    ) external returns (uint256 profit) {
        // This function should only be called by this contract itself
        require(msg.sender == address(this), "Unauthorized caller");
        
        // 1. Execute the first swap (buy tokenB with tokenA)
        uint256 boughtAmount = _executeSwap(
            tokenA,
            tokenB,
            borrowedAmount,
            buyDex,
            curvePoolForBuy,
            true  // true for buy
        );
        
        // 2. Execute the second swap (sell tokenB for tokenA)
        uint256 receivedAmount = _executeSwap(
            tokenB,
            tokenA,
            boughtAmount,
            sellDex,
            curvePoolForSell,
            false  // false for sell
        );
        
        // 3. Verify profit
        require(receivedAmount > totalRepayment, "No profit made");
        
        // 4. Calculate and return profit
        profit = receivedAmount - totalRepayment;
        return profit;
    }
    
    /**
     * @dev Internal function to execute a swap on a specific DEX
     */
    function _executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        Dex dex,
        address curvePool,
        bool isBuy
    ) internal returns (uint256 amountOut) {
        // Approve the token spending before swap
        IERC20(tokenIn).approve(
            dex == Dex.Uniswap ? UNISWAP_V3_ROUTER :
            dex == Dex.Sushiswap ? SUSHISWAP_ROUTER :
            curvePool,  // for Curve
            amountIn
        );
        
        // Execute the swap based on the DEX
        if (dex == Dex.Uniswap) {
            // Uniswap V3 swap
            ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 3000,  // 0.3% fee tier
                recipient: address(this),
                deadline: block.timestamp + 300,  // 5 minutes deadline
                amountIn: amountIn,
                amountOutMinimum: 0,  // No slippage check here, but should be calculated in production
                sqrtPriceLimitX96: 0  // No price limit
            });
            
            amountOut = uniswapRouter.exactInputSingle(params);
        } 
        else if (dex == Dex.Sushiswap) {
            // Sushiswap swap
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            
            uint[] memory amounts = sushiswapRouter.swapExactTokensForTokens(
                amountIn,
                0,  // No slippage check here, but should be calculated in production
                path,
                address(this),
                block.timestamp + 300  // 5 minutes deadline
            );
            
            amountOut = amounts[amounts.length - 1];
        } 
        else if (dex == Dex.Curve) {
            // Curve swap
            require(curvePool != address(0), "Curve pool address not provided");
            
            ICurvePool pool = ICurvePool(curvePool);
            
            // Determine token indices in the Curve pool
            // Note: This is a simplified version. In production, you'd need to identify the correct indices
            int128 i = isBuy ? int128(0) : int128(1);  // For the tokenIn
            int128 j = isBuy ? int128(1) : int128(0);  // For the tokenOut
            
            // Execute the exchange
            amountOut = pool.exchange(i, j, amountIn, 0);  // 0 as min amount, but should be calculated in production
        } 
        else {
            revert("Unsupported DEX");
        }
        
        require(amountOut > 0, "Swap returned zero amount");
        return amountOut;
    }
    
    /**
     * @dev Function to withdraw tokens from the contract
     */
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }
    
    /**
     * @dev Function to withdraw ETH from the contract
     */
    function withdrawETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
    
    /**
     * @dev Fallback function to receive ETH
     */
    receive() external payable {}
}