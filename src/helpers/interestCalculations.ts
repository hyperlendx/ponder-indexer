import { ReserveDataEvent } from "ponder:schema";
import { eq, desc, lte, and } from "ponder";

// Constants for ray math (1e27 precision)
export const RAY = 1000000000000000000000000000n; // 1e27
export const SECONDS_PER_YEAR = 31536000n; // 365 * 24 * 60 * 60

/**
 * Ray math operations for high precision calculations (AAVE methodology)
 *
 * Ray precision uses 1e27 (27 decimal places) for maximum precision in DeFi calculations.
 * This matches AAVE's implementation and prevents precision loss in interest calculations.
 *
 * All operations include rounding to nearest integer to match AAVE's behavior.
 */
export class RayMath {
    /**
     * Multiply two ray values with proper rounding
     *
     * Formula: (a * b + RAY/2) / RAY
     * The RAY/2 addition provides rounding to nearest integer.
     *
     * @param a - First ray value (1e27 precision)
     * @param b - Second ray value (1e27 precision)
     * @returns Product in ray precision with proper rounding
     *
     * @example
     * // Multiply 1.5 * 2.0 in ray precision
     * const a = 1500000000000000000000000000n; // 1.5 RAY
     * const b = 2000000000000000000000000000n; // 2.0 RAY
     * const result = RayMath.rayMul(a, b);
     * // Result: 3000000000000000000000000000n (3.0 RAY)
     */
    static rayMul(a: bigint, b: bigint): bigint {
        return (a * b + RAY / 2n) / RAY;
    }

    /**
     * Divide two ray values with proper rounding
     *
     * Formula: (a * RAY + b/2) / b
     * The b/2 addition provides rounding to nearest integer.
     *
     * @param a - Dividend in ray precision (1e27)
     * @param b - Divisor in ray precision (1e27)
     * @returns Quotient in ray precision with proper rounding
     * @throws Will throw if b is zero (division by zero)
     *
     * @example
     * // Divide 3.0 / 2.0 in ray precision
     * const a = 3000000000000000000000000000n; // 3.0 RAY
     * const b = 2000000000000000000000000000n; // 2.0 RAY
     * const result = RayMath.rayDiv(a, b);
     * // Result: 1500000000000000000000000000n (1.5 RAY)
     */
    static rayDiv(a: bigint, b: bigint): bigint {
        if (b === 0n) {
            throw new Error("Division by zero in rayDiv");
        }
        return (a * RAY + b / 2n) / b;
    }
}

/**
 * Calculate linear interest factor using AAVE's methodology
 *
 * This function calculates the linear interest growth factor over a given time period.
 * The formula follows AAVE's implementation: 1 + (rate * timeElapsed) / SECONDS_PER_YEAR
 *
 * @param liquidityRate - The annual liquidity rate in ray precision (1e27)
 *                       Expected range: 0 to ~1e27 (0% to ~100% APY)
 * @param timeElapsed - Time elapsed in seconds since last update
 *                     Expected range: 0 to ~31536000 (0 seconds to 1 year)
 * @returns The linear interest factor in ray precision (1e27)
 *          Returns RAY (1e27) for 0% interest or 0 time elapsed
 *          Returns > RAY for positive interest rates
 *
 * @example
 * // Calculate 5% APY over 30 days
 * const rate = 50000000000000000000000000n; // 5% in ray
 * const thirtyDays = 30n * 24n * 60n * 60n; // 30 days in seconds
 * const factor = calculateLinearInterest(rate, thirtyDays);
 * // Result: ~1.004109589041095890n (RAY + ~0.41% for 30 days)
 */
export function calculateLinearInterest(
    liquidityRate: bigint,
    timeElapsed: bigint
): bigint {
    // If no time has elapsed, return RAY (no growth)
    if (timeElapsed === 0n) {
        return RAY;
    }

    // If rate is 0, return RAY (no growth)
    if (liquidityRate === 0n) {
        return RAY;
    }

    // Calculate: RAY + (liquidityRate * timeElapsed) / SECONDS_PER_YEAR
    // SECONDS_PER_YEAR is not in RAY units, so use plain integer division
    const interestAccrued = (liquidityRate * timeElapsed) / SECONDS_PER_YEAR;

    return RAY + interestAccrued;
}

/**
 * Calculate new liquidity index using AAVE's linear interest methodology
 *
 * This is the core function for calculating how liquidity indices grow over time
 * in AAVE protocol. It applies linear interest growth to the previous index.
 * Compounding happens across successive index updates, not within this single calculation.
 *
 * Formula: newIndex = previousIndex * linearInterestFactor
 * Where: linearInterestFactor = 1 + (rate * timeElapsed) / SECONDS_PER_YEAR
 *
 * @param previousIndex - The previous liquidity index in ray precision (1e27)
 *                       Expected range: RAY to ~10*RAY (normal growth bounds)
 *                       Should never be less than RAY (1e27)
 * @param liquidityRate - The annual liquidity rate in ray precision (1e27)
 *                       Expected range: 0 to ~1e27 (0% to ~100% APY)
 * @param timeElapsed - Time elapsed in seconds since the previous index
 *                     Expected range: 0 to ~31536000 (0 seconds to 1 year)
 * @returns The new liquidity index in ray precision (1e27)
 *          Always >= previousIndex (indices only grow, never shrink)
 *
 * @example
 * // Calculate new index after 1 day with 10% APY
 * const prevIndex = 1050000000000000000000000000n; // 1.05 RAY (previous growth)
 * const rate = 100000000000000000000000000n; // 10% APY in ray
 * const oneDay = 86400n; // 1 day in seconds
 * const newIndex = calculateLiquidityIndex(prevIndex, rate, oneDay);
 * // Result: ~1.050287671232876712n RAY (linear growth applied to previous index)
 */
export function calculateLiquidityIndex(
    previousIndex: bigint,
    liquidityRate: bigint,
    timeElapsed: bigint
): bigint {
    // Validate inputs
    if (previousIndex < RAY) {
        console.warn(`Invalid previousIndex: ${previousIndex.toString()}, using RAY`);
        previousIndex = RAY;
    }

    // Calculate the linear interest factor
    const linearInterestFactor = calculateLinearInterest(liquidityRate, timeElapsed);

    // Apply linear interest growth: newIndex = previousIndex * linearInterestFactor
    return RayMath.rayMul(previousIndex, linearInterestFactor);
}

/**
 * Calculate liquidity index for any timestamp using AAVE's methodology
 *
 * This function reconstructs the liquidity index at any point in time by:
 * 1. Finding the most recent ReserveDataEvent at or before the target timestamp
 * 2. Applying AAVE's linear interest compounding from that point to the target time
 * 3. Handling edge cases like missing data or same-transaction updates
 *
 * The calculation follows AAVE's core formula:
 * newIndex = previousIndex * (1 + (rate * timeElapsed) / SECONDS_PER_YEAR)
 *
 * @param context - Ponder context containing database access (db or db.sql)
 * @param reserve - The reserve/asset address to calculate index for
 *                 Expected format: 0x-prefixed hex string (ERC20 token address)
 * @param targetTimestamp - Unix timestamp to calculate index for
 *                         Expected range: Any valid Unix timestamp
 * @param currentTxHash - Optional transaction hash for same-tx optimization
 *                       If provided, checks for ReserveDataEvent in same transaction first
 * @returns Promise<bigint> - The liquidity index at target timestamp in ray precision (1e27)
 *                           Returns RAY (1e27) if no historical data found
 *                           Always returns >= RAY (indices never go below 1.0)
 *
 * @example
 * // Get liquidity index for USDC at specific timestamp
 * const usdcAddress = "0xa0b86a33e6ba3e5e2b9b2b8b5b6b7b8b9b0b1b2b3";
 * const timestamp = 1640995200; // Jan 1, 2022
 * const index = await calculateLiquidityIndexAtTimestamp(
 *   context,
 *   usdcAddress,
 *   timestamp
 * );
 * // Result: bigint representing index like 1050000000000000000000000000n (1.05 RAY)
 */
export async function calculateLiquidityIndexAtTimestamp(
    context: any,
    reserve: string,
    targetTimestamp: number,
    currentTxHash?: string
): Promise<bigint> {
    const { db } = context;

    try {
        // If we have a current transaction hash, first check if there's a ReserveDataEvent
        // in the same transaction (which would be the most up-to-date index)
        if (currentTxHash) {
            const dbQuery = db.sql || db;
            const sameTransactionEvents = await dbQuery
                .select()
                .from(ReserveDataEvent)
                .where(
                    and(
                        eq(ReserveDataEvent.reserve, reserve as `0x${string}`),
                        eq(ReserveDataEvent.txHash, currentTxHash as `0x${string}`)
                    )
                );

            if (sameTransactionEvents && sameTransactionEvents.length > 0) {
                console.log("🎯 Found ReserveDataEvent in same transaction, using updated liquidity index");
                console.log("reserve", reserve);
                console.log("liquidityIndex", sameTransactionEvents[0].liquidityIndex);
                return BigInt(sameTransactionEvents[0].liquidityIndex);
            }
        }

        // Query for the most recent ReserveDataEvent at or before the target timestamp
        // Use the reserveTimestampIdx index for efficient querying
        console.log(`🔍 Querying ReserveDataEvent for reserve ${reserve}, target timestamp: ${targetTimestamp}, currentTxHash: ${currentTxHash || 'none'}`);
        const dbQuery = db.sql || db;
        const events = await dbQuery
            .select()
            .from(ReserveDataEvent)
            .where(
                and(
                    eq(ReserveDataEvent.reserve, reserve as `0x${string}`),
                    lte(ReserveDataEvent.timestamp, targetTimestamp)
                )
            )
            .orderBy(desc(ReserveDataEvent.timestamp))
            .limit(1); // Only need the most recent one
        console.log(`📊 Found ${events.length} events before target timestamp`);

        if (!events || events.length === 0) {
            // No historical data found before the target timestamp
            // For current position queries, try to get the most recent event regardless of timestamp
            if (!currentTxHash) {
                console.log(`🔍 No events before target timestamp ${targetTimestamp}, looking for most recent ReserveDataEvent for reserve ${reserve}...`);
                const dbQuery = db.sql || db;
                const mostRecentEvents = await dbQuery
                    .select()
                    .from(ReserveDataEvent)
                    .where(eq(ReserveDataEvent.reserve, reserve as `0x${string}`))
                    .orderBy(desc(ReserveDataEvent.timestamp))
                    .limit(1);

                if (mostRecentEvents && mostRecentEvents.length > 0) {
                    console.log("✅ Found most recent ReserveDataEvent:", {
                        reserve,
                        liquidityIndex: mostRecentEvents[0].liquidityIndex,
                        timestamp: mostRecentEvents[0].timestamp,
                        targetTimestamp
                    });
                    return BigInt(mostRecentEvents[0].liquidityIndex);
                }
            }

            // No historical data found at all, return default liquidity index (1 RAY)
            console.warn(`⚠️ No ReserveDataEvent found for reserve ${reserve}, using default RAY`);
            return RAY;
        }

        const closestEvent = events[0];
        console.log("closestEvent", closestEvent);
        // Validate the base liquidity index
        const baseLiquidityIndex = BigInt(closestEvent.liquidityIndex);
        console.log("baseLiquidityIndex", baseLiquidityIndex);
        if (!validateLiquidityIndex(baseLiquidityIndex)) {
            console.warn(`Invalid liquidity index found: ${baseLiquidityIndex.toString()}, using default RAY`);
            return RAY;
        }

        // If the event timestamp exactly matches the target, return the index directly
        if (closestEvent.timestamp === targetTimestamp) {
            return baseLiquidityIndex;
        }

        // Calculate the time elapsed since the closest event
        const timeElapsed = BigInt(targetTimestamp - closestEvent.timestamp);
        console.log("timeElapsed", timeElapsed);

        // Get the liquidity rate from the event (in ray precision)
        const liquidityRate = BigInt(closestEvent.liquidityRate);
        console.log("liquidityRate", liquidityRate);

        // Use AAVE's liquidity index calculation to get the new index
        const newLiquidityIndex = calculateLiquidityIndex(
            baseLiquidityIndex,
            liquidityRate,
            timeElapsed
        );
        console.log("newLiquidityIndex", newLiquidityIndex);
        // Validate the calculated index
        if (!validateLiquidityIndex(newLiquidityIndex)) {
            console.warn(`Calculated liquidity index is invalid: ${newLiquidityIndex.toString()}, using base index`);
            return baseLiquidityIndex;
        }

        return newLiquidityIndex;

    } catch (error) {
        console.error(`Error calculating liquidity index for reserve ${reserve} at timestamp ${targetTimestamp}:`, error);
        // Return default index on error to prevent system failure
        return RAY;
    }
}




/**
 * Calculate user interest earnings between two timestamps using AAVE methodology
 *
 * This function calculates how much interest a user earned on their scaled balance
 * over a specific time period by comparing liquidity indices at start and end times.
 *
 * The core principle: scaled balances remain constant, but their "actual" value
 * grows as the liquidity index increases due to interest accrual.
 *
 * Formula: earnings = scaledBalance * (endIndex - startIndex) / RAY
 *
 * @param context - Ponder context containing database access
 * @param user - User address (0x-prefixed hex string)
 * @param asset - Asset/reserve address (0x-prefixed hex string)
 * @param scaledBalance - User's scaled balance in the asset (ray precision)
 *                       This should remain constant during the period
 * @param startTimestamp - Start time for interest calculation (Unix timestamp)
 * @param endTimestamp - End time for interest calculation (Unix timestamp)
 *                      Must be >= startTimestamp
 * @returns Promise containing:
 *   - interestEarned: Interest earned in ray precision (1e27)
 *   - startIndex: Liquidity index at start time
 *   - endIndex: Liquidity index at end time
 *
 * @example
 * // Calculate interest earned on 1000 USDC over 30 days
 * const result = await calculateUserInterestEarnings(
 *   context,
 *   "0x123...", // user address
 *   "0xa0b...", // USDC address
 *   1000000000000000000000000000000n, // 1000 scaled USDC
 *   startTimestamp,
 *   endTimestamp
 * );
 * // result.interestEarned might be ~4166666666666666666666667n (≈4.17 USDC interest)
 */
export async function calculateUserInterestEarnings(
    context: any,
    user: string,
    asset: string,
    scaledBalance: bigint,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    interestEarned: bigint;
    startIndex: bigint;
    endIndex: bigint;
}> {
    const startIndex = await calculateLiquidityIndexAtTimestamp(
        context,
        asset,
        startTimestamp
    );

    const endIndex = await calculateLiquidityIndexAtTimestamp(
        context,
        asset,
        endTimestamp
    );

    // Calculate interest earned
    const startBalance = RayMath.rayMul(scaledBalance, startIndex);
    const endBalance = RayMath.rayMul(scaledBalance, endIndex);
    const interestEarned = endBalance - startBalance;

    return {
        interestEarned,
        startIndex,
        endIndex
    };
}

/**
 * Calculate actual balance from scaled balance and liquidity index (AAVE methodology)
 *
 * In AAVE, user balances are stored as "scaled balances" which remain constant,
 * while the "actual balance" grows over time as interest accrues through the
 * increasing liquidity index.
 *
 * Formula: actualBalance = scaledBalance * liquidityIndex / RAY
 *
 * @param scaledBalance - The user's scaled balance in ray precision (1e27)
 *                       This value remains constant in storage
 * @param liquidityIndex - Current liquidity index in ray precision (1e27)
 *                        This grows over time as interest accrues
 * @returns The actual balance in ray precision (1e27)
 *          This represents the current withdrawable amount
 *
 * @example
 * // User deposited 1000 USDC when index was 1.0, now index is 1.05
 * const scaled = 1000000000000000000000000000000n; // 1000 scaled USDC
 * const index = 1050000000000000000000000000n;     // 1.05 RAY
 * const actual = calculateActualBalance(scaled, index);
 * // Result: 1050000000000000000000000000000n (1050 actual USDC)
 */
export function calculateActualBalance(scaledBalance: bigint, liquidityIndex: bigint): bigint {
    return RayMath.rayMul(scaledBalance, liquidityIndex);
}

/**
 * Calculate scaled balance from actual balance and liquidity index (AAVE methodology)
 *
 * This is the inverse operation of calculateActualBalance, used when converting
 * deposit/withdrawal amounts to scaled balances for storage.
 *
 * Formula: scaledBalance = actualBalance * RAY / liquidityIndex
 *
 * @param actualBalance - The actual balance amount in ray precision (1e27)
 *                       This is typically a deposit/withdrawal amount
 * @param liquidityIndex - Current liquidity index in ray precision (1e27)
 *                        Used to normalize the amount to scaled form
 * @returns The scaled balance in ray precision (1e27)
 *          This is the amount stored in user's balance record
 *
 * @example
 * // User deposits 1000 USDC when index is 1.05
 * const actual = 1000000000000000000000000000000n; // 1000 actual USDC
 * const index = 1050000000000000000000000000n;     // 1.05 RAY
 * const scaled = calculateScaledBalance(actual, index);
 * // Result: ~952380952380952380952380952n (≈952.38 scaled USDC)
 */
export function calculateScaledBalance(actualBalance: bigint, liquidityIndex: bigint): bigint {
    return RayMath.rayDiv(actualBalance, liquidityIndex);
}

/**
 * Get the start and end timestamps for a given month
 */
export function getMonthTimestamps(year: number, month: number): {
    startTimestamp: number;
    endTimestamp: number;
} {
    const startDate = new Date(year, month - 1, 1); // month is 0-indexed in Date
    const endDate = new Date(year, month, 0, 23, 59, 59, 999); // Last day of month
    
    return {
        startTimestamp: Math.floor(startDate.getTime() / 1000),
        endTimestamp: Math.floor(endDate.getTime() / 1000)
    };
}

/**
 * Get year and month from timestamp
 */
export function getYearMonthFromTimestamp(timestamp: number): {
    year: number;
    month: number;
} {
    const date = new Date(timestamp * 1000);
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1 // Convert to 1-12 range
    };
}

/**
 * Validate that a liquidity index is reasonable
 */
export function validateLiquidityIndex(index: bigint): boolean {
    // Index should be at least 1 RAY and not exceed reasonable bounds
    return index >= RAY && index <= RAY * 10n; // Max 10x growth
}

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
