/**
 * Isolated Pair Exchange Rate Calculations
 *
 * Functions for calculating exchange rates at specific timestamps using vault state tracking.
 * Exchange rates are calculated by tracking totalAsset.amount and totalAsset.shares,
 * exactly as the contract does.
 */

import { calculateIsolatedPairExchangeRate } from "./vaultExchangeRate";

/**
 * Request-scoped cache for exchange rates
 * Key format: `${pair}_${timestamp}`
 * This prevents redundant calculations within a single API request
 */
const exchangeRateCache = new Map<string, bigint>();

/**
 * Clear the exchange rate cache
 * Should be called at the start of each API request
 */
export function clearExchangeRateCache(): void {
    exchangeRateCache.clear();
}

/**
 * Calculate exchange rate at a specific timestamp using vault state tracking
 *
 * This function calculates exchange rates by tracking totalAsset.amount and totalAsset.shares,
 * exactly as the contract does. This provides 100% accurate exchange rates without any
 * approximation or extrapolation.
 *
 * @param context - Ponder context with database access
 * @param pair - Isolated pair address
 * @param targetTimestamp - Target timestamp to calculate exchange rate for
 * @returns Exchange rate at target timestamp (1e18 precision)
 *
 * @example
 * ```typescript
 * // Get exchange rate at specific timestamp
 * const rate = await calculateIsolatedPairExchangeRateAtTimestamp(context, "0xPair...", 1234567890);
 * // Returns: 1050000000000000000n (1.05 exchange rate)
 * ```
 *
 * @note
 * This calculation is:
 * - 100% accurate (uses actual vault state tracking)
 * - Deterministic (same inputs always produce same output)
 * - Matches contract exactly (uses same formula: totalAsset.amount / totalAsset.shares)
 */
export async function calculateIsolatedPairExchangeRateAtTimestamp(
    context: any,
    pair: string,
    targetTimestamp: number
): Promise<bigint> {
    return calculateIsolatedPairExchangeRate(context, pair, targetTimestamp);
}

/**
 * Get exchange rate for an isolated pair at a specific timestamp (with caching)
 *
 * This function uses a request-scoped cache to avoid redundant calculations
 * for the same pair+timestamp combination within a single API request.
 *
 * @param context - Ponder context with database access
 * @param pair - Isolated pair address
 * @param timestamp - Target timestamp
 * @returns Exchange rate at timestamp (1e18 precision)
 */
export async function getIsolatedPairExchangeRate(
    context: any,
    pair: string,
    timestamp: number
): Promise<bigint> {
    // Check cache first
    const cacheKey = `${pair}_${timestamp}`;
    const cached = exchangeRateCache.get(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    // Calculate and cache
    const rate = await calculateIsolatedPairExchangeRateAtTimestamp(context, pair, timestamp);
    exchangeRateCache.set(cacheKey, rate);
    return rate;
}

