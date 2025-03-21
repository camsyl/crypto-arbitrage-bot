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
 * @title FlashLoanArbitrageOptimized
 * @dev Gas-optimized contract for flash loan-based arbitrage between different DEXes
 */
contract FlashLoanArbitrageOptimized is IFlashLoanReceiver, Ownable, ReentrancyGuard {
    // Constants (immutable for gas savings)
    address private immutable AAVE_LENDING_POOL;
    address private immutable UNISWAP_V3_ROUTER;
    address private immutable SUSHISWAP_ROUTER;
    
    // Interfaces
    ILendingPool public immutable lendingPool;
    ISwapRouter public immutable uniswapRouter;
    ISushiRouter public immutable sushiswapRouter;
    
    // Custom errors (saves gas vs require with string)
    error InvalidTokenAddresses();
    error InvalidAmount();
    error UnauthorizedCaller();
    error InvalidLendingPool();
    error InvalidInitiator();
    error NoProfit();
    error SwapFailed();
    error UnsupportedDex();
    error InsufficientProfit();
    error InsufficientLiquidity();
    
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

    // Liquidity check parameters
    struct LiquidityParams {
        uint256 minLiquidityPercentage; // Minimum percentage of token reserve compared to trade size (1000 = 10%)
        uint256 maxPriceImpact;         // Maximum price impact in basis points (100 = 1%)
    }

    // Default liquidity parameters
    LiquidityParams public liquidityParams = LiquidityParams({
        minLiquidityPercentage: 2000,   // 20% minimum liquidity
        maxPriceImpact: 100             // 1% max price impact
    });
    
    /**
     * @dev Constructor to initialize the contract with required addresses
     */
    constructor(address _lendingPool, address _uniswapRouter, address _sushiswapRouter) {
        AAVE_LENDING_POOL = _lendingPool;
        UNISWAP_V3_ROUTER = _uniswapRouter;
        SUSHISWAP_ROUTER = _sushiswapRouter;
        
        lendingPool = ILendingPool(_lendingPool);
        uniswapRouter = ISwapRouter(_uniswapRouter);
        sushiswapRouter = ISushiRouter(_sushiswapRouter);
    }
    
    /**
     * @dev Execute a flash loan arbitrage with safety checks
     * @param tokenA The address of the token to borrow
     * @param tokenB The address of the token to swap with
     * @param amount The amount to borrow
     * @param buyDex The DEX to buy tokenB with tokenA
     * @param sellDex The DEX to sell tokenB for tokenA
     * @param curvePoolForBuy The Curve pool address for buy (if applicable)
     * @param curvePoolForSell The Curve pool address for sell (if applicable)
     * @param minProfitAmount Minimum profit to consider the arbitrage successful
     */
    function executeArbitrage(
        address tokenA,
        address tokenB,
        uint256 amount,
        Dex buyDex,
        Dex sellDex,
        address curvePoolForBuy,
        address curvePoolForSell,
        uint256 minProfitAmount
    ) external onlyOwner nonReentrant {
        // Use custom errors instead of require for gas savings
        if(tokenA == address(0) || tokenB == address(0)) revert InvalidTokenAddresses();
        if(amount == 0) revert InvalidAmount();
        
        // Pre-check DEX liquidity to avoid failed transactions
        if(!_checkLiquidity(tokenA, tokenB, amount, buyDex, curvePoolForBuy)) 
            revert InsufficientLiquidity();
        
        // Encode parameters for the flash loan callback
        bytes memory params = abi.encode(
            tokenA,
            tokenB,
            buyDex,
            sellDex,
            curvePoolForBuy,
            curvePoolForSell,
            minProfitAmount
        );
        
        // Create flash loan parameters (optimized to minimize memory usage)
        address[] memory assets = new address[](1);
        assets[0] = tokenA;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // 0 = no debt
        
        // Call Aave's flash loan function
        lendingPool.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            params,
            0
        );
    }
    
    /**
     * @dev Flash loan callback function
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Validate using custom errors (more gas efficient)
        if(msg.sender != AAVE_LENDING_POOL) revert InvalidLendingPool();
        if(initiator != address(this)) revert InvalidInitiator();
        
        // Decode parameters efficiently
        (
            address tokenA,
            address tokenB,
            Dex buyDex,
            Dex sellDex,
            address curvePoolForBuy,
            address curvePoolForSell,
            uint256 minProfitAmount
        ) = abi.decode(params, (address, address, Dex, Dex, address, address, uint256));
        
        uint256 borrowedAmount = amounts[0];
        uint256 fee = premiums[0];
        uint256 totalRepayment = borrowedAmount + fee;
        
        try this.executeArbitrageLogic(
            tokenA,
            tokenB,
            borrowedAmount,
            buyDex,
            sellDex,
            curvePoolForBuy,
            curvePoolForSell,
            totalRepayment,
            minProfitAmount
        ) returns (uint256 profit) {
            emit ArbitrageExecuted(tokenA, tokenB, borrowedAmount, profit, block.timestamp);
        } catch Error(string memory reason) {
            emit ArbitrageFailed(tokenA, tokenB, reason, block.timestamp);
        } catch {
            emit ArbitrageFailed(tokenA, tokenB, "Unknown error", block.timestamp);
        }
        
        // Always approve and return true to repay the flash loan
        // This approval is safe since it's for a verified contract address
        IERC20(tokenA).approve(AAVE_LENDING_POOL, totalRepayment);
        return true;
    }

    /**
     * @dev Arbitrage logic function with better validation
     */
    function executeArbitrageLogic(
        address tokenA,
        address tokenB,
        uint256 borrowedAmount,
        Dex buyDex,
        Dex sellDex,
        address curvePoolForBuy,
        address curvePoolForSell,
        uint256 totalRepayment,
        uint256 minProfitAmount
    ) external returns (uint256 profit) {
        if(msg.sender != address(this)) revert UnauthorizedCaller();
        
        // 1. Calculate the expected output on the buy side with slippage check
        uint256 expectedBuyAmount = _calculateExpectedOutput(
            tokenA,
            tokenB,
            borrowedAmount,
            buyDex,
            curvePoolForBuy
        );
        
        // 2. Calculate the expected output on the sell side
        uint256 expectedSellAmount = _calculateExpectedOutput(
            tokenB,
            tokenA,
            expectedBuyAmount,
            sellDex,
            curvePoolForSell
        );
        
        // 3. Verify the overall profitability before executing swaps
        if(expectedSellAmount <= totalRepayment + minProfitAmount) 
            revert InsufficientProfit();
        
        // 4. Execute the swaps only if profitability is confirmed
        // Buy tokenB with tokenA
        uint256 actualBuyAmount = _executeSwap(
            tokenA,
            tokenB,
            borrowedAmount,
            expectedBuyAmount * 95 / 100, // 5% max slippage
            buyDex,
            curvePoolForBuy
        );
        
        // Sell tokenB for tokenA
        uint256 actualSellAmount = _executeSwap(
            tokenB,
            tokenA,
            actualBuyAmount,
            totalRepayment + minProfitAmount, // Ensure minimum profit
            sellDex,
            curvePoolForSell
        );
        
        // Final profit verification
        if(actualSellAmount <= totalRepayment + minProfitAmount) 
            revert NoProfit();
        
        profit = actualSellAmount - totalRepayment;
        return profit;
    }
    
    /**
     * @dev Calculate expected output without executing a swap
     */
    function _calculateExpectedOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        Dex dex,
        address pool
    ) internal view returns (uint256 amountOut) {
        if (dex == Dex.Uniswap) {
            // For Uniswap, we can use their quoter contract
            // This is a simplified version, in production you'd handle fee tiers better
            try ISwapRouter(UNISWAP_V3_ROUTER).quoteExactInputSingle(
                tokenIn,
                tokenOut,
                3000, // Assume 0.3% fee tier
                amountIn,
                0
            ) returns (uint256 quote) {
                return quote;
            } catch {
                revert SwapFailed();
            }
        } 
        else if (dex == Dex.Sushiswap) {
            // For Sushiswap, use getAmountsOut
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            
            try ISushiRouter(SUSHISWAP_ROUTER).getAmountsOut(amountIn, path) 
            returns (uint[] memory amounts) {
                return amounts[1];
            } catch {
                revert SwapFailed();
            }
        } 
        else if (dex == Dex.Curve) {
            if(pool == address(0)) revert InvalidTokenAddresses();
            
            // This is simplified - in production you'd determine i and j correctly
            try ICurvePool(pool).get_dy(0, 1, amountIn) returns (uint256 dy) {
                return dy;
            } catch {
                revert SwapFailed();
            }
        } 
        else {
            revert UnsupportedDex();
        }
    }
    
    /**
     * @dev Execute swap with slippage protection and optimization
     */
    function _executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        Dex dex,
        address curvePool
    ) internal returns (uint256 amountOut) {
        // Approve token spending (optimized by checking current allowance first)
        address spender = dex == Dex.Uniswap ? UNISWAP_V3_ROUTER :
                         dex == Dex.Sushiswap ? SUSHISWAP_ROUTER :
                         curvePool;
        
        // Only approve if needed (gas optimization)
        uint256 currentAllowance = IERC20(tokenIn).allowance(address(this), spender);
        if (currentAllowance < amountIn) {
            // If allowance is insufficient, set to max (avoids multiple approvals)
            IERC20(tokenIn).approve(spender, type(uint256).max);
        }
        
        if (dex == Dex.Uniswap) {
            // Uniswap V3 swap with slippage protection
            ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 3000,  // 0.3% fee tier
                recipient: address(this),
                deadline: block.timestamp + 60,  // 1 minute deadline (shorter is safer for MEV)
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            });
            
            amountOut = ISwapRouter(UNISWAP_V3_ROUTER).exactInputSingle(params);
        } 
        else if (dex == Dex.Sushiswap) {
            // Sushiswap swap with slippage protection
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            
            uint[] memory amounts = ISushiRouter(SUSHISWAP_ROUTER).swapExactTokensForTokens(
                amountIn,
                minAmountOut,
                path,
                address(this),
                block.timestamp + 60
            );
            
            amountOut = amounts[amounts.length - 1];
        } 
        else if (dex == Dex.Curve) {
            if(curvePool == address(0)) revert InvalidTokenAddresses();
            
            // Determine token indices (simplified)
            int128 i = 0;  // Token index for tokenIn
            int128 j = 1;  // Token index for tokenOut
            
            // Execute with minimum output check
            amountOut = ICurvePool(curvePool).exchange(i, j, amountIn, minAmountOut);
        } 
        else {
            revert UnsupportedDex();
        }
        
        if(amountOut < minAmountOut) revert SwapFailed();
        return amountOut;
    }
    
    /**
     * @dev Check if there's sufficient liquidity before executing flash loan
     */
    function _checkLiquidity(
        address tokenA,
        address tokenB, 
        uint256 amount,
        Dex dex,
        address pool
    ) internal view returns (bool) {
        // Get the expected output
        uint256 expectedOutput;
        
        try this._calculateExpectedOutput(tokenA, tokenB, amount, dex, pool) returns (uint256 output) {
            expectedOutput = output;
        } catch {
            return false; // Insufficient liquidity or error in calculation
        }
        
        // Check against minimum liquidity parameters
        // This is a simplified check - in production you'd do more thorough validation
        if (dex == Dex.Sushiswap) {
            // For Sushiswap and other V2-style DEXes
            address pairAddress = ISushiRouter(SUSHISWAP_ROUTER).factory();
            address pair = IUniswapV2Factory(pairAddress).getPair(tokenA, tokenB);
            
            if (pair == address(0)) return false;
            
            // Get reserves
            (uint112 reserve0, uint112 reserve1,) = IUniswapV2Pair(pair).getReserves();
            address token0 = IUniswapV2Pair(pair).token0();
            
            uint112 reserveA = tokenA == token0 ? reserve0 : reserve1;
            
            // Check if amount is too large compared to reserve
            if (amount * 10000 / reserveA > liquidityParams.minLiquidityPercentage) {
                return false; // Amount is too large relative to pool liquidity
            }
            
            return true;
        }
        
        // For other DEXes, we rely on the expectedOutput check
        return expectedOutput > 0;
    }
    
    /**
     * @dev Update liquidity check parameters
     */
    function setLiquidityParams(
        uint256 _minLiquidityPercentage,
        uint256 _maxPriceImpact
    ) external onlyOwner {
        liquidityParams.minLiquidityPercentage = _minLiquidityPercentage;
        liquidityParams.maxPriceImpact = _maxPriceImpact;
    }
    
    /**
     * @dev Withdraw tokens from the contract
     */
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }
    
    /**
     * @dev Withdraw ETH from the contract
     */
    function withdrawETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
    
    /**
     * @dev Receive ETH
     */
    receive() external payable {}
}

// Minimal interface for Uniswap V2 Factory
interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

// Minimal interface for Uniswap V2 Pair
interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
}