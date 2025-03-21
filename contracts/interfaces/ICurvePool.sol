// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

/**
 * @title ICurvePool
 * @dev Interface for Curve Finance pool contracts
 */
interface ICurvePool {
    /**
     * @dev Get amount of token j received for swapping dx of token i
     * @param i Index of input token
     * @param j Index of output token
     * @param dx Amount of input token
     * @return Amount of output token received
     */
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
    
    /**
     * @dev Exchange from token i to token j with amount dx
     * @param i Index of input token
     * @param j Index of output token
     * @param dx Amount of input token
     * @param min_dy Minimum amount of output token to receive
     * @return Amount of output token received
     */
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);
    
    /**
     * @dev Get the virtual price of the pool LP token
     * @return Virtual price with 18 decimals
     */
    function get_virtual_price() external view returns (uint256);
    
    /**
     * @dev Add liquidity to the pool
     * @param amounts Array of token amounts to deposit
     * @param min_mint_amount Minimum LP tokens to mint
     * @return Amount of LP tokens received
     */
    function add_liquidity(uint256[2] calldata amounts, uint256 min_mint_amount) external returns (uint256);
    
    /**
     * @dev Add liquidity to the pool (variations for different pool sizes)
     * @param amounts Array of token amounts to deposit
     * @param min_mint_amount Minimum LP tokens to mint
     * @return Amount of LP tokens received
     */
    function add_liquidity(uint256[3] calldata amounts, uint256 min_mint_amount) external returns (uint256);
    
    /**
     * @dev Add liquidity to the pool (variations for different pool sizes)
     * @param amounts Array of token amounts to deposit
     * @param min_mint_amount Minimum LP tokens to mint
     * @return Amount of LP tokens received
     */
    function add_liquidity(uint256[4] calldata amounts, uint256 min_mint_amount) external returns (uint256);
}