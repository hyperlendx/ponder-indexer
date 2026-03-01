/**
 * USD Value Calculation Utilities
 * 
 * Shared utility functions for calculating USD values from token amounts
 * using oracle prices with 8 decimals precision.
 */

/**
 * Calculate USD value from token amount and oracle price
 * 
 * @param amount - Token amount as bigint (in token's smallest unit)
 * @param assetPrice - Oracle price as bigint (8 decimals precision)
 * @param decimals - Token decimals
 * @returns USD value as number
 * 
 * @example
 * // Calculate USD value for 1000 USDC (6 decimals) at $1.00
 * const amount = 1000000000n; // 1000 USDC
 * const price = 100000000n;   // $1.00 with 8 decimals
 * const decimals = 6;
 * const usdValue = calculateUSDValueNumber(amount, price, decimals);
 * // Returns: 1000.0000
 */
export function calculateUSDValueNumber(
    amount: bigint, 
    assetPrice: bigint | undefined, 
    decimals: number
): number {
    if (!assetPrice || assetPrice === 0n) {
        return 0;
    }
    
    try {
        // Oracle prices have 8 decimals precision
        const ORACLE_DECIMALS = 8;
        
        // Formula: usdValue = (amount / 10^decimals) * (price / 10^8)
        // To avoid floating point, we calculate: (amount * price) / (10^decimals * 10^8)
        
        const numerator = amount * assetPrice;
        const denominator = BigInt(10 ** decimals) * BigInt(10 ** ORACLE_DECIMALS);
        
        // Calculate integer part and remainder for decimal places
        const integerPart = numerator / denominator;
        const remainder = numerator % denominator;
        
        // Format with 4 decimal places for USD
        const decimalPart = (remainder * 10000n) / denominator;
        
        // Convert to number for easier arithmetic
        return Number(integerPart) + Number(decimalPart) / 10000;
    } catch (error) {
        console.error("Error calculating USD value:", error);
        return 0;
    }
}

