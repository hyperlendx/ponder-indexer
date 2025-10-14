/**
 * Constants for Isolated Pair Calculations
 * 
 * These constants are used throughout the isolated pair calculation modules.
 * Isolated pairs use ERC4626-style shares-based accounting with 1e18 precision.
 */

/**
 * Exchange rate precision (from IsolatedAbi: EXCHANGE_PRECISION = 1e18)
 * 
 * This is the precision used for exchange rate calculations in isolated pairs.
 * Unlike AAVE's RAY (1e27), isolated pairs use 1e18 precision following the ERC4626 standard.
 * 
 * Formula: assets = shares × exchangeRate / EXCHANGE_PRECISION
 */
export const EXCHANGE_PRECISION = 1000000000000000000n; // 1e18

