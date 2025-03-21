// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

/**
 * @title ISushiRouter
 * @dev Interface for SushiSwap router contracts
 */
interface ISushiRouter {
    /**
     * @dev Given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
     * @param amountIn Amount of input asset
     * @param reserveIn Reserve of input asset in the pair
     * @param reserveOut Reserve of output asset in the pair
     * @return amountOut Maximum output amount
     */
    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) external pure returns (uint amountOut);

    /**
     * @dev Given an output amount of an asset and pair reserves, returns the required input amount of the other asset
     * @param amountOut Amount of output asset
     * @param reserveIn Reserve of input asset in the pair
     * @param reserveOut Reserve of output asset in the pair
     * @return amountIn Required input amount
     */
    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) external pure returns (uint amountIn);

    /**
     * @dev Returns the amounts out for a given input amount and path
     * @param amountIn Amount of input asset
     * @param path Array of token addresses representing the path
     * @return amounts Array of output amounts
     */
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);

    /**
     * @dev Returns the amounts in for a given output amount and path
     * @param amountOut Amount of output asset
     * @param path Array of token addresses representing the path
     * @return amounts Array of input amounts
     */
    function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts);

    /**
     * @dev Swaps an exact amount of tokens for another token through the path (a, b, ..., c)
     * @param amountIn Amount of input tokens to send
     * @param amountOutMin Minimum amount of output tokens to receive
     * @param path Array of token addresses representing the path
     * @param to Address to receive the output tokens
     * @param deadline Unix timestamp deadline by which the transaction must confirm
     * @return amounts Array of output amounts
     */
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    /**
     * @dev Swaps an exact amount of ETH for tokens through the path (WETH, b, ..., c)
     * @param amountOutMin Minimum amount of output tokens to receive
     * @param path Array of token addresses representing the path
     * @param to Address to receive the output tokens
     * @param deadline Unix timestamp deadline by which the transaction must confirm
     * @return amounts Array of output amounts
     */
    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts);

    /**
     * @dev Swaps an exact amount of tokens for ETH through the path (a, b, ..., WETH)
     * @param amountIn Amount of input tokens to send
     * @param amountOutMin Minimum amount of ETH to receive
     * @param path Array of token addresses representing the path
     * @param to Address to receive the ETH
     * @param deadline Unix timestamp deadline by which the transaction must confirm
     * @return amounts Array of output amounts
     */
    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}