import { RAY } from "./rayMath";

/**
 * Format ray value for display (convert to decimal with reasonable precision)
 * Simple approach using direct division for accurate decimal representation
 *
 * @param value - The ray value to format (1e27 precision)
 * @param maxDecimals - Maximum number of decimal places to show (default: 12)
 * @returns Formatted string with appropriate decimal places
 */
export function formatRayValue(value: bigint, maxDecimals: number = 12): string {
    if (value === 0n) return "0.000000";

    // Simple division: value / RAY gives the correct decimal representation
    const result = Number(value) / Number(RAY);

    // Format with specified decimal places and remove trailing zeros
    return result.toFixed(maxDecimals).replace(/0+$/, '').replace(/\.$/, '') || "0.000000";
}

/**
 * Format token balance for display (convert from wei to human-readable)
 *
 * Token balances are stored in wei (smallest unit), not RAY precision.
 * For example, 1 USDC (6 decimals) = 1,000,000 wei
 *              1 ETH (18 decimals) = 1,000,000,000,000,000,000 wei
 *
 * @param value - The balance in wei (token's smallest unit)
 * @param decimals - Number of decimals for the token (default: 18 for most ERC20)
 * @param maxDecimals - Maximum number of decimal places to show (default: 6)
 * @returns Formatted string with appropriate decimal places
 */
export function formatTokenBalance(value: bigint, decimals: number = 18, maxDecimals: number = 6): string {
    if (value === 0n) return "0.000000";

    // Convert from wei to token amount: value / 10^decimals
    const divisor = 10n ** BigInt(decimals);
    const result = Number(value) / Number(divisor);

    // Format with specified decimal places and remove trailing zeros
    return result.toFixed(maxDecimals).replace(/0+$/, '').replace(/\.$/, '') || "0.000000";
}

