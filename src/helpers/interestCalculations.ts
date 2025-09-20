import { ReserveDataEvent } from "ponder:schema";
import { eq, desc, lte, and } from "ponder";

// Constants for ray math (1e27 precision)
export const RAY = 1000000000000000000000000000n; // 1e27
export const SECONDS_PER_YEAR = 31536000n; // 365 * 24 * 60 * 60

/**
 * Ray math operations for high precision calculations
 */
export class RayMath {
    /**
     * Multiply two ray values
     */
    static rayMul(a: bigint, b: bigint): bigint {
        return (a * b + RAY / 2n) / RAY;
    }

    /**
     * Divide two ray values
     */
    static rayDiv(a: bigint, b: bigint): bigint {
        return (a * RAY + b / 2n) / b;
    }

    /**
     * Convert a percentage rate to ray format
     * @param rate - Rate in basis points (e.g., 500 = 5%)
     */
    static percentToRay(rate: number): bigint {
        return BigInt(rate) * RAY / 10000n;
    }

    /**
     * Convert ray to percentage
     */
    static rayToPercent(ray: bigint): number {
        return Number(ray * 10000n / RAY);
    }
}

/**
 * Calculate liquidityIndex for any timestamp using historical data lookup and linear interpolation
 * Finds the closest liquidity index at or before the target timestamp and calculates the exact index
 * using the linear interest formula: newIndex = previousIndex * (1 + (rate * timeElapsed) / SECONDS_PER_YEAR)
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
            const sameTransactionEvents = await db.sql
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
        const events = await db.sql
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
                const mostRecentEvents = await db.sql
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
        // If no time has elapsed, return the base index
        if (timeElapsed === 0n) {
            return baseLiquidityIndex;
        }

        // Get the liquidity rate from the event (in ray precision)
        const liquidityRate = BigInt(closestEvent.liquidityRate);
        console.log("liquidityRate", liquidityRate);
        // Calculate the interest factor: (liquidityRate * timeElapsed) / SECONDS_PER_YEAR
        // Using RayMath for precise calculations
        const interestFactor = RayMath.rayDiv(
            RayMath.rayMul(liquidityRate, timeElapsed),
            SECONDS_PER_YEAR
        );
        console.log("interestFactor", interestFactor);
        // Calculate the new index: baseLiquidityIndex * (1 + interestFactor)
        // Where (1 + interestFactor) = RAY + interestFactor
        const growthFactor = RAY + interestFactor;
        console.log("growthFactor", growthFactor);
        const newLiquidityIndex = RayMath.rayMul(baseLiquidityIndex, growthFactor);
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
 * Calculate user interest earnings between two timestamps
 * Formula: earnings = (scaledBalance * endIndex - scaledBalance * startIndex) / 1e27
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
 * Calculate actual balance from scaled balance and current liquidity index
 */
export function calculateActualBalance(scaledBalance: bigint, liquidityIndex: bigint): bigint {
    return RayMath.rayMul(scaledBalance, liquidityIndex);
}

/**
 * Calculate scaled balance from actual balance and current liquidity index
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
 * Calculate compound interest rate for a given period
 * This is useful for APY calculations
 */
export function calculateCompoundRate(
    rate: bigint,
    timeElapsed: bigint,
    compoundingFrequency: bigint = SECONDS_PER_YEAR
): bigint {
    // For simplicity, using linear approximation for now
    // In production, you might want to implement proper compound interest
    return RayMath.rayMul(rate, RayMath.rayDiv(timeElapsed, compoundingFrequency));
}

/**
 * Validate that a liquidity index is reasonable
 */
export function validateLiquidityIndex(index: bigint): boolean {
    // Index should be at least 1 RAY and not exceed reasonable bounds
    return index >= RAY && index <= RAY * 10n; // Max 10x growth
}

/**
 * Format ray value for display (convert to decimal with specified precision)
 */
export function formatRayValue(value: bigint, decimals: number = 18): string {
    const divisor = 10n ** BigInt(decimals);
    const scaled = value / (RAY / divisor);
    const integer = scaled / divisor;
    const fraction = scaled % divisor;
    
    return `${integer}.${fraction.toString().padStart(decimals, '0')}`;
}
